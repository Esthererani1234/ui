import {
  json,
  requireAdmin,
  service,
} from "../_lib/payments.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    await requireAdmin(request);
    const requestedDays = Number(request.query?.days || 30);
    const days = [7, 30, 90, 365].includes(requestedDays)
      ? requestedDays
      : 30;
    const { data, error } = await service().rpc(
      "admin_traffic_analytics",
      { p_days: days },
    );
    if (error) throw error;
    return json(response, 200, { report: data });
  } catch (error) {
    console.error("admin traffic analytics failed", error);
    return json(response, error.status || 500, {
      error: error.status
        ? error.message
        : "Traffic analytics are temporarily unavailable.",
    });
  }
}
