// Send only intentional edits so tracking/notes do not overwrite a newer payment.
export function orderChanges(order, form) {
  const changes = { order_id: order.id, reason: form.reason.trim() };
  for (const [field, input] of [["status", "status"], ["payment_status", "paymentStatus"], ["tracking_number", "trackingNumber"], ["internal_notes", "internalNotes"]]) {
    if ((order[field] || "") !== form[input]) changes[field] = form[input];
  }
  return changes;
}

export function orderStatusBlock(order, status, paymentStatus) {
  if (status === order.status) return "";
  if (order.status === "cancelled") return "Cancelled orders cannot be reopened.";
  if (order.status === "completed") return "Completed orders cannot be moved backwards.";
  if (order.status === "shipped" && status !== "completed") return "Shipped orders can only be completed; cancellations require a return.";
  if (order.status === "processing" && !["shipped", "cancelled"].includes(status)) return "Processing orders can be shipped or cancelled.";
  if (status === "payment_received" && paymentStatus !== "paid") return "Confirm payment first.";
  if (["processing", "shipped", "completed"].includes(status)) {
    if (paymentStatus !== "paid") return "Confirm payment before shipping or processing.";
    if (order.risk_decision && order.risk_decision !== "approved") return "Approve the order in Risk center first.";
    if (status === "completed" && order.status !== "shipped") return "Mark the order shipped before completing it.";
  }
  return "";
}
