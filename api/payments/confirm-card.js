import Stripe from "stripe";
import {
  assertPayable,
  authenticateCustomer,
  customerOrder,
  insertAttempt,
  json,
  readJson,
} from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

const safeMessage = (error) => {
  if (error?.type === "StripeCardError") return error.message || "Your card was declined.";
  if (error?.code === "card_declined") return "Your card was declined. Try another card or contact your bank.";
  if (error?.code === "expired_card") return "This card is expired. Try another card.";
  if (error?.code === "incorrect_cvc") return "The security code is incorrect.";
  if (error?.code === "processing_error") return "The bank could not process this card. Please try again.";
  return "Card payment could not be completed. Your cart and locked order are still saved.";
};

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  let order;
  try {
    if (process.env.STRIPE_ENABLED !== "true" || !process.env.STRIPE_SECRET_KEY) {
      throw Object.assign(new Error("Card payment is temporarily unavailable."), { status: 503 });
    }
    const { user } = await authenticateCustomer(request);
    const body = await readJson(request);
    const orderId = Number(body.order_id);
    const confirmationTokenId = String(body.confirmation_token_id || "");
    if (!Number.isSafeInteger(orderId) || orderId < 1) return json(response, 400, { error: "Invalid order" });
    if (!/^ctoken_[A-Za-z0-9_]+$/.test(confirmationTokenId)) {
      return json(response, 400, { error: "Secure card details are incomplete." });
    }

    order = await customerOrder(orderId, user.id);
    assertPayable(order, "card");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(order.total) * 100),
      currency: "usd",
      confirm: true,
      confirmation_token: confirmationTokenId,
      payment_method_types: ["card"],
      description: `GoldOnTheSpot order ${order.order_number}`,
      receipt_email: order.email,
      return_url: `${process.env.SITE_URL || "https://goldonthespot.com"}/account?tab=orders&order=${encodeURIComponent(order.order_number)}&payment=return`,
      metadata: {
        order_id: String(order.id),
        order_number: order.order_number,
        user_id: user.id,
      },
    }, { idempotencyKey: `gots-card-${order.id}-${confirmationTokenId}` });

    try {
      await insertAttempt(
        order,
        "stripe",
        intent.id,
        intent.status === "succeeded" ? "paid" : "pending",
        null,
        order.price_locked_until,
        intent,
      );
    } catch (recordError) {
      console.error("Stripe confirmed but local attempt recording failed", intent.id, recordError);
      if (intent.status !== "succeeded") throw recordError;
    }

    return json(response, 200, {
      order_id: order.id,
      order_number: order.order_number,
      status: intent.status,
      client_secret: intent.status === "requires_action" ? intent.client_secret : null,
    });
  } catch (error) {
    console.error("embedded card confirmation failed", error?.type || error?.code || error);
    const intent = error?.payment_intent;
    if (order && intent?.id) {
      await insertAttempt(order, "stripe", intent.id, "failed", null, order.price_locked_until, intent).catch(() => {});
    }
    const expired = error?.status === 409 && /expired/i.test(error.message || "");
    return json(response, expired ? 409 : (error.status || (error?.type === "StripeCardError" ? 402 : 500)), {
      error: expired
        ? "The 10-minute price lock expired. Review the refreshed total before paying."
        : (error.status ? error.message : safeMessage(error)),
      code: expired ? "price_expired" : (error?.code || "payment_failed"),
      status: intent?.status || "requires_payment_method",
    });
  }
}
