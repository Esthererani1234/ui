import { assertPayable, authenticateCustomer, customerOrder, escapeHtml, insertAttempt, json, readJson, sendPaymentEmail, wireSettings } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user } = await authenticateCustomer(request);
    const body = await readJson(request);
    const orderId = Number(body.order_id);
    if (!Number.isSafeInteger(orderId) || orderId < 1) return json(response, 400, { error: "Invalid order" });
    const order = await customerOrder(orderId, user.id);

    if (order.payment_method === "wire") {
      assertPayable(order, "wire");
      const settings = await wireSettings();
      const reference = order.payment_reference || order.order_number;
      await insertAttempt(order, "manual_wire", reference, "pending", null, order.price_locked_until, {});
      const lines = [settings.bank_name, settings.beneficiary_name, settings.routing_number && `Routing: ${settings.routing_number}`, settings.account_number && `Account: ${settings.account_number}`, settings.swift_code && `SWIFT: ${settings.swift_code}`, `Reference: ${reference}`, settings.notes].filter(Boolean);
      const email = await sendPaymentEmail({
        to: order.email,
        subject: `Wire instructions for ${order.order_number}`,
        html: `<h1>GoldOnTheSpot wire instructions</h1><p>Your order total is <strong>$${Number(order.total).toFixed(2)}</strong>.</p>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p>Use the order reference exactly so we can match your payment. Your order ships only after cleared funds and review.</p>`,
      });
      return json(response, 200, { method: "wire", order_number: order.order_number, reference, instructions: settings, email_sent: email.sent });
    }

    if (order.payment_method === "card") {
      if (process.env.STRIPE_ENABLED !== "true") throw Object.assign(new Error("Card checkout is awaiting processor approval"), { status: 503 });
      if (["paid", "refunded", "disputed"].includes(order.payment_status)) {
        throw Object.assign(new Error("This order cannot accept another payment"), { status: 409 });
      }
      const siteUrl = process.env.SITE_URL || "https://goldonthespot.com";
      return json(response, 200, {
        method: "card",
        embedded: true,
        url: `${siteUrl}/checkout?resume_order=${order.id}`,
      });
    }

    if (order.payment_method === "crypto") {
      assertPayable(order, "crypto");
      if (process.env.NOWPAYMENTS_ENABLED !== "true") throw Object.assign(new Error("Crypto checkout is not enabled yet"), { status: 503 });
      if (!process.env.NOWPAYMENTS_API_KEY || !process.env.NOWPAYMENTS_IPN_SECRET) throw new Error("NOWPayments is not configured");
      if (order.payment_provider === "nowpayments" && order.provider_checkout_url) return json(response, 200, { method: "crypto", url: order.provider_checkout_url });
      const siteUrl = process.env.SITE_URL || "https://goldonthespot.com";
      const apiUrl = (process.env.NOWPAYMENTS_API_URL || "https://api.nowpayments.io").replace(/\/$/, "");
      const checkout = await fetch(`${apiUrl}/v1/invoice`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.NOWPAYMENTS_API_KEY },
        body: JSON.stringify({
          price_amount: Number(order.total),
          price_currency: "usd",
          order_id: order.order_number,
          order_description: `GoldOnTheSpot order ${order.order_number}`,
          ipn_callback_url: `${siteUrl}/api/payments/nowpayments-webhook`,
          success_url: `${siteUrl}/account?tab=orders&order=${encodeURIComponent(order.order_number)}&payment=return`,
          cancel_url: `${siteUrl}/cart?order=${encodeURIComponent(order.order_number)}&payment=cancelled`,
        }),
      });
      const invoice = await checkout.json().catch(() => ({}));
      const invoiceId = String(invoice?.id || invoice?.invoice_id || "");
      const checkoutUrl = invoice?.invoice_url || invoice?.url || "";
      if (!checkout.ok || !invoiceId || !checkoutUrl) {
        console.error("NOWPayments invoice creation failed", checkout.status, invoice?.status || invoice?.message || invoice?.error || "unknown response");
        throw new Error("NOWPayments could not create the crypto checkout");
      }
      await insertAttempt(order, "nowpayments", invoiceId, "pending", checkoutUrl, order.price_locked_until, invoice);
      return json(response, 200, { method: "crypto", url: checkoutUrl });
    }

    return json(response, 400, { error: "Unsupported payment method" });
  } catch (error) {
    console.error("create checkout failed", error);
    return json(response, error.status || 500, { error: error.status ? error.message : "Payment checkout is temporarily unavailable" });
  }
}
