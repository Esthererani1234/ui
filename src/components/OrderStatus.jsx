import { orderStatusLabel } from "../lib/pricing";

export default function OrderStatus({ order }) {
  const fulfillment = order.status === "completed"
    ? "Delivered / completed"
    : orderStatusLabel(order.status);

  if (order.payment_status !== "refunded") {
    return <span className={`status-pill ${order.status}`}>{fulfillment}</span>;
  }

  return (
    <div className="order-status-summary">
      <span className="status-pill refunded">Refunded</span>
      <small className="order-fulfillment-history">Fulfillment: {fulfillment}</small>
    </div>
  );
}
