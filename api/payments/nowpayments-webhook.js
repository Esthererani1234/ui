import crypto from "node:crypto";
import { json, readRaw, recordEvent, service } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sorted(value[key]);
    return result;
  }, {});
};

const validSignature = (payload, received) => {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET || "";
  if (!secret || !/^[a-f\d]{128}$/i.test(received || "")) return false;
  const expected = crypto.createHmac("sha512", secret).update(JSON.stringify(sorted(payload))).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
};

const mapped = (status) => ({
  waiting: ["pending", "pending"],
  confirming: ["confirming", "confirming"],
  confirmed: ["confirming", "confirming"],
  spending: ["confirming", "confirming"],
  sending: ["confirming", "confirming"],
  partially_paid: ["partially_paid", "pending"],
  finished: ["paid", "paid"],
  failed: ["failed", "failed"],
  refunded: ["refunded", "refunded"],
  expired: ["expired", "expired"],
})[status] || null;

const exactAmount = (left, right) => Number.isFinite(Number(left))
  && Math.abs(Number(left) - Number(right)) <= 0.009;

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    if (!process.env.NOWPAYMENTS_API_KEY || !process.env.NOWPAYMENTS_IPN_SECRET) {
      return json(response, 503, { error: "Crypto notifications are not configured" });
    }

    const raw = await readRaw(request, 250_000);
    let notification;
    try { notification = JSON.parse(raw.toString("utf8")); }
    catch { return json(response, 400, { error: "Invalid notification" }); }

    const signature = String(request.headers["x-nowpayments-sig"] || "");
    if (!validSignature(notification, signature)) return json(response, 401, { error: "Invalid signature" });

    const paymentId = String(notification?.payment_id || "");
    if (!paymentId) return json(response, 400, { error: "Invalid notification" });

    // Confirm the signed callback against NOWPayments directly before changing
    // money or fulfillment state in our database.
    const apiUrl = (process.env.NOWPAYMENTS_API_URL || "https://api.nowpayments.io").replace(/\/$/, "");
    const verification = await fetch(`${apiUrl}/v1/payment/${encodeURIComponent(paymentId)}`, {
      headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY, accept: "application/json" },
    });
    const payment = await verification.json().catch(() => ({}));
    if (!verification.ok || String(payment?.payment_id || "") !== paymentId) {
      return json(response, 400, { error: "Payment verification failed" });
    }

    const orderNumber = String(payment.order_id || notification.order_id || "");
    const invoiceId = String(payment.invoice_id || notification.invoice_id || "");
    if (!orderNumber || !invoiceId) return json(response, 400, { error: "Payment is missing its order reference" });

    const { data: order, error: orderError } = await service().from("orders")
      .select("id,total,order_number,payment_provider,provider_payment_id")
      .eq("order_number", orderNumber).maybeSingle();
    if (orderError) throw orderError;
    if (!order
      || order.payment_provider !== "nowpayments"
      || String(order.provider_payment_id) !== invoiceId
      || String(payment.order_id || "") !== order.order_number
      || String(payment.price_currency || "").toLowerCase() !== "usd"
      || !exactAmount(payment.price_amount, order.total)) {
      return json(response, 400, { error: "Payment does not match the order" });
    }

    const paymentStatus = String(payment.payment_status || "").toLowerCase();
    const eventId = `${paymentId}:${paymentStatus}:${String(payment.actually_paid ?? notification.actually_paid ?? "")}`;
    const fresh = await recordEvent("nowpayments", eventId, order.id, `payment.${paymentStatus}`, true, payment);
    if (!fresh) return json(response, 200, { received: true, duplicate: true });

    const state = mapped(paymentStatus);
    if (!state) return json(response, 200, { received: true, ignored: true });
    const [orderPaymentStatus, attemptStatus] = state;
    const { error } = await service().rpc("mark_payment_state", {
      p_order_id: order.id,
      p_provider: "nowpayments",
      p_provider_payment_id: invoiceId,
      p_payment_status: orderPaymentStatus,
      p_attempt_status: attemptStatus,
      p_paid_at: orderPaymentStatus === "paid" ? new Date().toISOString() : null,
    });
    if (error) throw error;
    return json(response, 200, { received: true });
  } catch (error) {
    console.error("NOWPayments webhook failed", error);
    return json(response, 400, { error: "Invalid notification" });
  }
}
