import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock3, Headphones, MapPin, Package, Printer, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { money, orderStatusLabel } from "../lib/pricing";
import InvoiceDownload from './InvoiceDownload';

function OrderPhoto({ src, name }) {
  const [failedSource, setFailedSource] = useState("");
  return <div className="receipt-item-photo">{src && failedSource !== src
    ? <img src={src} alt={name} width="112" height="112" loading="lazy" decoding="async" onError={() => setFailedSource(src)} />
    : <Package aria-label="Product photo unavailable" />}</div>;
}

export function OrderItems({ items = [] }) {
  return <div className="receipt-items">{items.map((item) => {
    const product = item.products;
    const image = item.product_image_url || product?.image_url || product?.image_urls?.[0];
    const category = item.product_category || product?.category;
    return <article className="receipt-item" key={item.id}>
      <OrderPhoto src={image} name={item.product_name} />
      <div className="receipt-item-description"><span>{[item.metal, category, Number(item.metal_weight_oz) > 0 ? `${Number(item.metal_weight_oz)} troy oz each` : ""].filter(Boolean).join(" · ")}</span><h3>{item.product_name}</h3>{item.sku && <small>SKU {item.sku}</small>}<p>Quantity <b>{item.quantity}</b><span>{money(item.unit_price)} each</span></p></div>
      <strong className="receipt-item-total">{money(item.line_total)}</strong>
    </article>;
  })}</div>;
}

function receiptMessage(order, checking) {
  if (order.status === "cancelled") return ["Order cancelled", "This order is closed. Contact us if you have a question about a payment or refund."];
  if (order.payment_status === "refunded") return ["Payment refunded", "Your order record shows a refund. Your payment provider determines when it appears in your account."];
  if (order.payment_status === "disputed") return ["Payment under review", "Please contact our support team for help with this order."];
  if (order.status === "completed") return ["Your order has been delivered", "Your order details and tracking information are saved here for you."];
  if (order.status === "shipped") return ["Your order is on its way", "Your tracking details are below. Thank you for choosing GoldOnTheSpot."];
  if (order.payment_status === "paid") return ["Thank you. Payment received.", order.status === "processing" ? "We’re preparing your bullion order. Tracking will appear here when it ships." : "Your payment is confirmed. We’re reviewing your order before preparing it for shipment."];
  if (order.payment_method === "wire") return ["Your order is reserved", "Complete your wire transfer using the secure instructions below. We’ll prepare your order after funds clear and the order review is complete."];
  if (["failed", "expired"].includes(order.payment_status)) return ["Payment needs attention", "Your order is saved. Review the payment status below before trying again or contacting support."];
  return [checking ? "Confirming your payment" : "Your order is saved", "We’re waiting for payment confirmation. Do not place another order while your payment is being checked. You can refresh this page to see the latest status."];
}

export default function OrderReceipt({ order, checking, refreshing, error, onRefresh, children }) {
  const [title, description] = receiptMessage(order, checking);
  const paid = order.payment_status === "paid";
  const shipping = order.shipping_address || {};
  const address = shipping.address || shipping;
  const steps = [
    ["Order placed", true], ["Payment received", paid],
    ["Preparing", ["processing", "shipped", "completed"].includes(order.status)],
    ["Shipped", ["shipped", "completed"].includes(order.status)], ["Delivered", order.status === "completed"],
  ];
  return <section className="order-receipt" aria-labelledby="receipt-title">
    <div className="receipt-toolbar"><Link to="/account?tab=orders"><ArrowLeft /> All orders</Link><div><InvoiceDownload order={order}/><button type="button" className="text-button" disabled={refreshing} onClick={onRefresh}><RefreshCw /> {refreshing ? "Refreshing…" : "Refresh status"}</button><button type="button" className="text-button" onClick={() => window.print()}><Printer /> Print order</button></div></div>
    <header className="receipt-heading"><div className={`receipt-confirmation-icon ${paid ? "paid" : ""}`}>{paid ? <CheckCircle2 /> : <Clock3 />}</div><div><span className="eyebrow dark">YOUR GOLDONTHESPOT ORDER</span><h1 id="receipt-title">{title}</h1><p>{description}</p><div className="receipt-reference"><b>{order.order_number}</b><span>Placed {new Date(order.created_at).toLocaleString()}</span></div></div></header>
    {error && <div className="form-message error" role="alert">{error}</div>}
    {order.status !== "cancelled" && !["refunded","disputed"].includes(order.payment_status) && <ol className="receipt-progress" aria-label="Order progress">{steps.map(([label, done]) => <li key={label} className={done ? "done" : ""}>{done ? <CheckCircle2 /> : <span className="receipt-step-dot" />}<span>{label}</span></li>)}</ol>}
    <div className="receipt-grid"><div className="receipt-main">
      <section className="receipt-panel"><div className="receipt-panel-title"><Package /><h2>Your bullion</h2></div><OrderItems items={order.order_items || []} /></section>
      <section className="receipt-panel"><div className="receipt-panel-title"><Truck /><h2>Delivery & tracking</h2></div><div className="receipt-delivery"><div><MapPin /><address><b>{shipping.name || [order.first_name, order.last_name].filter(Boolean).join(" ")}</b>{[address.line1 || address.address_line_1, address.line2 || address.address_line_2, [address.city, address.state, address.postal_code].filter(Boolean).join(", "), address.country].filter(Boolean).map((line, index) => <span key={index}>{line}</span>)}</address></div><div><b>{order.status === "completed" ? "Delivered" : orderStatusLabel(order.status)}</b>{order.tracking_number ? <p>Tracking number<br /><strong className="receipt-tracking">{order.tracking_number}</strong></p> : <p>Tracking will appear here after your order ships.</p>}</div></div></section>
      <section className="receipt-panel"><h2>Order contact</h2><p className="receipt-contact">{order.email}{order.phone && <span>{order.phone}</span>}</p>{order.customer_notes && <><h3>Your order notes</h3><p className="receipt-notes">{order.customer_notes}</p></>}</section>
    </div><aside className="receipt-summary">
      <section className="receipt-panel"><h2>Order summary</h2><dl className="receipt-totals"><div><dt>Items</dt><dd>{money(order.subtotal)}</dd></div><div><dt>Shipping</dt><dd>{Number(order.shipping_amount) ? money(order.shipping_amount) : "Free"}</dd></div>{Number(order.insurance_amount) > 0 && <div><dt>Insurance</dt><dd>{money(order.insurance_amount)}</dd></div>}{Number(order.payment_surcharge) > 0 && <div><dt>Card surcharge</dt><dd>{money(order.payment_surcharge)}</dd></div>}<div className="receipt-grand-total"><dt>Order total</dt><dd>{money(order.total)}<small>USD</small></dd></div></dl><div className="receipt-payment-status"><ShieldCheck /><div><b>{order.payment_method === "card" ? "Card payment" : order.payment_method === "wire" ? "Wire transfer" : "Cryptocurrency"}</b><span>{orderStatusLabel(order.payment_status)}</span></div></div>{children}</section>
      <section className="receipt-help"><Headphones /><h2>We’re here to help</h2><p>Ask a question about this order. We’ll include <b>{order.order_number}</b> in your request.</p><Link className="button button-outline full" to={`/support?new=1&order=${encodeURIComponent(order.order_number)}`}>Get help with this order</Link></section>
      <Link className="button button-dark full" to="/shop">Continue shopping</Link>
    </aside></div>
  </section>;
}
