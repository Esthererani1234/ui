import { json, readJson, recordEvent, service } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

const mapped = (status) => ({ new: ["unpaid", "pending"], paid: ["pending", "pending"], confirmed: ["confirming", "confirming"], complete: ["paid", "paid"], expired: ["expired", "expired"], invalid: ["failed", "failed"], refunded: ["refunded", "refunded"] })[status] || ["pending", "pending"];

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const notification = await readJson(request);
    const invoiceId = String(notification?.data?.id || notification?.id || "");
    if (!invoiceId || !process.env.BITPAY_API_TOKEN) return json(response, 400, { error: "Invalid notification" });
    // BitPay IPNs are not signed. Treat the IPN only as a trigger and retrieve
    // the authoritative invoice directly from BitPay before changing an order.
    const verifyUrl = new URL(`/invoices/${encodeURIComponent(invoiceId)}`, process.env.BITPAY_API_URL || "https://bitpay.com");
    verifyUrl.searchParams.set("token", process.env.BITPAY_API_TOKEN);
    const verify = await fetch(verifyUrl, { headers: { "x-accept-version": "2.0.0" } });
    const payload = await verify.json();
    const invoice = payload?.data;
    if (!verify.ok || invoice?.id !== invoiceId) return json(response, 400, { error: "Invoice verification failed" });
    const { data: order } = await service().from("orders").select("id,total,order_number").eq("payment_provider", "bitpay").eq("provider_payment_id", invoiceId).maybeSingle();
    if (!order || invoice.orderId !== order.order_number || Math.abs(Number(invoice.price) - Number(order.total)) > 0.009 || invoice.currency !== "USD") return json(response, 400, { error: "Invoice does not match the order" });
    const eventId = `${invoiceId}:${invoice.status}:${invoice.exceptionStatus || "none"}`;
    const fresh = await recordEvent("bitpay", eventId, order.id, `invoice.${invoice.status}`, true, invoice);
    if (!fresh) return json(response, 200, { received: true, duplicate: true });
    const [paymentStatus, attemptStatus] = mapped(invoice.status);
    const { error } = await service().rpc("mark_payment_state", { p_order_id: order.id, p_provider: "bitpay", p_provider_payment_id: invoiceId, p_payment_status: paymentStatus, p_attempt_status: attemptStatus, p_paid_at: paymentStatus === "paid" ? new Date().toISOString() : null });
    if (error) throw error;
    response.status(200).end();
  } catch (error) {
    console.error("bitpay webhook failed", error);
    return json(response, 400, { error: "Invalid notification" });
  }
}
