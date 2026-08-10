import { assertPayable, authenticateCustomer, customerOrder, escapeHtml, insertAttempt, json, nextWirePaymentDeadline, readJson, sendPaymentEmail, wireSettings } from "../_lib/payments.js";

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
      const dueAt = nextWirePaymentDeadline();
      await insertAttempt(order, "manual_wire", reference, "pending", null, dueAt, {});
      const lines = [
        ["Bank", settings.bank_name],
        ["Beneficiary", settings.beneficiary_name],
        ["Routing number", settings.routing_number],
        ["Account number", settings.account_number],
        ["SWIFT / BIC", settings.swift_code],
        ["Bank address", settings.bank_address],
        ["Order reference", reference],
      ].filter(([, value]) => Boolean(value));
      let email = { sent: false };
      try {
        email = await sendPaymentEmail({
          to: order.email,
          subject: `Wire instructions for ${order.order_number}`,
          html: `<div style="background:#f3f6f7;padding:32px 16px;font-family:Arial,sans-serif;color:#102c40"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #d5dee3;padding:30px"><div style="font-size:13px;letter-spacing:1.5px;color:#a66f00;font-weight:700">GOLDONTHESPOT</div><h1 style="margin:8px 0 10px;font-family:Georgia,serif">Bank-wire instructions</h1><p style="line-height:1.6">Your bullion order <strong>${escapeHtml(order.order_number)}</strong> has been placed at the locked total below and is awaiting payment.</p><div style="background:#08283b;color:#fff;padding:18px;margin:24px 0"><div style="font-size:13px;opacity:.8">SEND EXACTLY</div><div style="font-size:28px;font-weight:700">$${Number(order.total).toFixed(2)}</div><div style="margin-top:8px">Due ${escapeHtml(new Date(dueAt).toUTCString())}</div></div>${lines.map(([label, value]) => `<div style="padding:10px 0;border-bottom:1px solid #e4e9ec"><div style="font-size:12px;color:#627581;text-transform:uppercase">${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong></div>`).join("")}${settings.notes ? `<p style="line-height:1.6"><strong>Additional instructions:</strong> ${escapeHtml(settings.notes)}</p>` : ""}<p style="line-height:1.6;margin-top:24px">Use the order reference exactly so we can match your payment. Your order will ship only after funds have cleared and the payment has been verified.</p><p style="font-size:13px;color:#627581">GoldOnTheSpot will never ask for your banking password, verification code, or card number by email.</p></div></div>`,
        });
      } catch (emailError) {
        console.error("wire instruction email failed", emailError);
      }
      return json(response, 200, { method: "wire", order_number: order.order_number, reference, due_at: dueAt, instructions: settings, email_sent: email.sent });
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
