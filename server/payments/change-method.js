import {validWireAgreement} from "../../supabase/functions/_shared/wireAgreement.js";
import { rateLimit, strictObject, securityLog } from "../lib/security.js";
import {
  authenticateCustomer,
  customerOrder,
  json,
  readJson,
  service,
  wireSettings,
} from "../lib/payments.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    const { user } = await authenticateCustomer(request, { requireSms: true });
    await rateLimit(service(), "payment_change", user.id, 10, 600);
    const body = strictObject(await readJson(request), ['order_id', 'payment_method', 'wire_agreement']);
    const orderId = Number(body.order_id);

    if (!Number.isSafeInteger(orderId) || orderId < 1) {
      return json(response, 400, { error: "Invalid order" });
    }
    if (body.payment_method !== "wire") {
      return json(response, 400, { error: "Unsupported payment method" });
    }

    if (!validWireAgreement(body.wire_agreement)) return json(response,400,{error:"Accept the bank-wire purchase agreement before continuing."});
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
      "accept_wire_order",
      {
        p_order_id: orderId,
        p_user_id: user.id,
        p_agreement: body.wire_agreement,
        p_user_agent: String(request.headers["user-agent"] || "").slice(0,500),
      },
    );
    if (error) {
      throw Object.assign(
        new Error(
          ["P2005","P2006"].includes(error.code) ? error.message : /not found/i.test(error.message || "")
            ? "Order not found"
            : "This order could not be changed to bank wire.",
        ),
        { status: error.code === "P0002" ? 404 : 409 },
      );
    }

    return json(response, 200, data);
  } catch (error) {
    securityLog("change payment method failed", error);
    return json(response, error.status || 500, {
      error: error.status
        ? error.message
        : "Bank wire is temporarily unavailable.",
    });
  }
}
