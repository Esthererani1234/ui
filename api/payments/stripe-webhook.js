import Stripe from "stripe";
import { json, readRaw, recordEvent, service } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

const stateFor = (type, object) => {
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(type) && object.payment_status === "paid") return ["paid", "paid"];
  if (type === "payment_intent.succeeded") return ["paid", "paid"];
  if (["checkout.session.async_payment_failed", "payment_intent.payment_failed"].includes(type)) return ["failed", "failed"];
  if (type === "checkout.session.expired") return ["expired", "expired"];
  if (type === "charge.refunded") return ["refunded", "refunded"];
  if (type === "charge.dispute.created") return ["disputed", "disputed"];
  return ["pending", "pending"];
};

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) throw new Error("Stripe webhook is not configured");
    const raw = await readRaw(request);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(raw, request.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    const object = event.data.object;
    const orderId = Number(object.metadata?.order_id || object.payment_intent?.metadata?.order_id);
    if (!Number.isSafeInteger(orderId)) return json(response, 200, { received: true, ignored: true });
    const fresh = await recordEvent("stripe", event.id, orderId, event.type, true, object);
    if (!fresh) return json(response, 200, { received: true, duplicate: true });
    const [paymentStatus, attemptStatus] = stateFor(event.type, object);
    const providerId = object.object === "checkout.session" ? object.id : (object.payment_intent || object.id);
    const { error } = await service().rpc("mark_payment_state", { p_order_id: orderId, p_provider: "stripe", p_provider_payment_id: providerId, p_payment_status: paymentStatus, p_attempt_status: attemptStatus, p_paid_at: paymentStatus === "paid" ? new Date().toISOString() : null });
    if (error) throw error;
    return json(response, 200, { received: true });
  } catch (error) {
    console.error("stripe webhook failed", error);
    return json(response, 400, { error: "Invalid webhook" });
  }
}
