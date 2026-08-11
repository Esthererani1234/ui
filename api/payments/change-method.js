import {
  authenticateCustomer,
  customerOrder,
  json,
  readJson,
  service,
  wireSettings,
} from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    const { user } = await authenticateCustomer(request);
    const body = await readJson(request);
    const orderId = Number(body.order_id);

    if (!Number.isSafeInteger(orderId) || orderId < 1) {
      return json(response, 400, { error: "Invalid order" });
    }
    if (body.payment_method !== "wire") {
      return json(response, 400, { error: "Unsupported payment method" });
    }

    const order = await customerOrder(orderId, user.id);
    if (!["card", "wire"].includes(order.payment_method)) {
      return json(response, 409, {
        error: "This order cannot be changed to bank wire.",
      });
    }
    if (["paid", "refunded", "disputed"].includes(order.payment_status)) {
      return json(response, 409, {
        error: "This order can no longer change payment method.",
      });
    }
    if (["cancelled", "completed", "shipped"].includes(order.status)) {
      return json(response, 409, {
        error: "This order can no longer change payment method.",
      });
    }

    // Fail closed if the encrypted wire destination is unavailable.
    const settings = await wireSettings();
    if (!settings?.routing_number || !settings?.account_number) {
      throw Object.assign(
        new Error("Bank wire is temporarily unavailable."),
        { status: 503 },
      );
    }

    const { data, error } = await service().rpc(
      "convert_unpaid_card_order_to_wire",
      {
        p_order_id: orderId,
        p_user_id: user.id,
      },
    );
    if (error) {
      throw Object.assign(
        new Error(
          /not found/i.test(error.message || "")
            ? "Order not found"
            : "This order could not be changed to bank wire.",
        ),
        { status: error.code === "P0002" ? 404 : 409 },
      );
    }

    return json(response, 200, data);
  } catch (error) {
    console.error("change payment method failed", error);
    return json(response, error.status || 500, {
      error: error.status
        ? error.message
        : "Bank wire is temporarily unavailable.",
    });
  }
}
