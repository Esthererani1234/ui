import { authenticateCustomer, customerOrder, json, wireSettings } from "../_lib/payments.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user } = await authenticateCustomer(request);
    const orderId = Number(request.query.order_id);
    const order = await customerOrder(orderId, user.id);
    if (order.payment_method !== "wire") return json(response, 404, { error: "Wire instructions are not available for this order" });
    const instructions = await wireSettings();
    return json(response, 200, { order_number: order.order_number, total: order.total, reference: order.payment_reference || order.order_number, instructions });
  } catch (error) {
    return json(response, error.status || 500, { error: error.status ? error.message : "Wire instructions are temporarily unavailable" });
  }
}

