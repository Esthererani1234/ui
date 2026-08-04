import Stripe from "stripe";
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
      assertPayable(order, "card");
      if (process.env.STRIPE_ENABLED !== "true") throw Object.assign(new Error("Card checkout is awaiting processor approval"), { status: 503 });
      if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const existing = order.payment_provider === "stripe" && order.provider_payment_id
        ? await stripe.checkout.sessions.retrieve(order.provider_payment_id).catch(() => null) : null;
      if (existing?.url && existing.status === "open") return json(response, 200, { method: "card", url: existing.url });
      const siteUrl = process.env.SITE_URL || "https://goldonthespot.com";
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: order.email,
        client_reference_id: order.order_number,
        line_items: [{ price_data: { currency: "usd", product_data: { name: `GoldOnTheSpot order ${order.order_number}`, description: `${order.order_items?.length || 0} bullion line item(s)` }, unit_amount: Math.round(Number(order.total) * 100) }, quantity: 1 }],
        metadata: { order_id: String(order.id), order_number: order.order_number, user_id: user.id },
        payment_intent_data: { metadata: { order_id: String(order.id), order_number: order.order_number, user_id: user.id } },
        success_url: `${siteUrl}/account?tab=orders&order=${encodeURIComponent(order.order_number)}&payment=return`,
        cancel_url: `${siteUrl}/account?tab=orders&order=${encodeURIComponent(order.order_number)}&payment=cancelled`,
      }, { idempotencyKey: `gots-checkout-${order.id}` });
      await insertAttempt(order, "stripe", session.id, "pending", session.url, order.price_locked_until, session);
      return json(response, 200, { method: "card", url: session.url });
    }

    if (order.payment_method === "crypto") {
      assertPayable(order, "crypto");
      if (process.env.BITPAY_ENABLED !== "true") throw Object.assign(new Error("Bitcoin checkout is not enabled yet"), { status: 503 });
      if (!process.env.BITPAY_API_TOKEN) throw new Error("BitPay is not configured");
      if (order.payment_provider === "bitpay" && order.provider_checkout_url) return json(response, 200, { method: "crypto", url: order.provider_checkout_url });
      const siteUrl = process.env.SITE_URL || "https://goldonthespot.com";
      const bitpay = await fetch(`${process.env.BITPAY_API_URL || "https://bitpay.com"}/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-accept-version": "2.0.0" },
        body: JSON.stringify({ token: process.env.BITPAY_API_TOKEN, price: Number(order.total), currency: "USD", orderId: order.order_number, itemDesc: `GoldOnTheSpot order ${order.order_number}`, notificationURL: `${siteUrl}/api/payments/bitpay-webhook`, redirectURL: `${siteUrl}/account?tab=orders&order=${encodeURIComponent(order.order_number)}&payment=return`, buyer: { name: `${order.first_name} ${order.last_name}`, email: order.email }, physical: true, transactionSpeed: "medium", acceptanceWindow: 600000, extendedNotifications: true }),
      });
      const payload = await bitpay.json();
      if (!bitpay.ok || !payload?.data?.id || !payload?.data?.url) throw new Error(payload?.error || "BitPay could not create the invoice");
      const invoice = payload.data;
      await insertAttempt(order, "bitpay", invoice.id, "pending", invoice.url, invoice.expirationTime ? new Date(invoice.expirationTime).toISOString() : order.price_locked_until, invoice);
      return json(response, 200, { method: "crypto", url: invoice.url });
    }

    return json(response, 400, { error: "Unsupported payment method" });
  } catch (error) {
    console.error("create checkout failed", error);
    return json(response, error.status || 500, { error: error.status ? error.message : "Payment checkout is temporarily unavailable" });
  }
}
