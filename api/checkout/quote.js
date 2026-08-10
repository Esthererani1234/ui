import { authenticateCustomer, customerOrder, json, readJson } from "../_lib/payments.js";
import { createQuote, refreshCardOrder } from "../_lib/quotes.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user } = await authenticateCustomer(request);
    const body = await readJson(request);
    if (body.order_id != null) {
      const orderId = Number(body.order_id);
      if (!Number.isSafeInteger(orderId) || orderId < 1) return json(response, 400, { error: "Invalid order" });
      const order = await customerOrder(orderId, user.id);
      if (order.payment_method !== "card") return json(response, 409, { error: "Only card orders can be refreshed here." });
      if (["paid", "refunded", "disputed"].includes(order.payment_status)) {
        return json(response, 409, { error: "This order can no longer accept payment." });
      }
      return json(response, 200, { ...(await refreshCardOrder(order.id)), order_number: order.order_number });
    }
    return json(response, 201, await createQuote(user.id, body.cart));
  } catch (error) {
    console.error("checkout quote failed", error);
    return json(response, error.status || 500, {
      error: error.status ? error.message : "A fresh market quote is temporarily unavailable. Please try again.",
    });
  }
}
