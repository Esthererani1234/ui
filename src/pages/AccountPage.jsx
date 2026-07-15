import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { CheckCircle2, LogOut, Package, UserRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel } from "../lib/pricing";
import { useAuth } from "../state/AuthContext";

const orderFields = "id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number, created_at, updated_at, order_items(*)";

export default function AccountPage() {
  const { user, profile, isAdmin, signOut, refreshProfile } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  const [active, setActive] = useState("orders");
  const [form, setForm] = useState({ first_name: profile?.first_name || "", last_name: profile?.last_name || "", phone: profile?.phone || "" });
  const [message, setMessage] = useState("");
  const highlightedOrder = params.get("order");

  useEffect(() => {
    supabase.from("orders").select(orderFields).order("created_at", { ascending: false }).then(({ data }) => setOrders(data || []));
  }, []);

  const saveProfile = async (event) => {
    event.preventDefault();
    const { error } = await supabase.from("profiles").update(form).eq("id", user.id);
    setMessage(error ? error.message : "Profile updated.");
    if (!error) refreshProfile();
  };

  return (
    <section className="section account-section"><div className="container">
      {highlightedOrder && <div className="success-banner"><CheckCircle2 /><div><b>Order {highlightedOrder} was placed successfully.</b><span>Your price is locked. Payment and review details are shown below.</span></div></div>}
      <div className="account-header"><div><span className="eyebrow dark">CUSTOMER ACCOUNT</span><h1>Welcome{profile?.first_name ? `, ${profile.first_name}` : ""}</h1><p>{user.email}</p></div><div>{isAdmin && <a className="button button-dark" href="/admin">Open admin dashboard</a>}<button className="button button-outline" onClick={signOut}><LogOut size={16} /> Sign out</button></div></div>
      <div className="account-layout"><aside className="account-nav"><button className={active === "orders" ? "active" : ""} onClick={() => setActive("orders")}><Package /> Orders</button><button className={active === "profile" ? "active" : ""} onClick={() => setActive("profile")}><UserRound /> Profile</button></aside>
        <div className="account-content">{active === "orders" ? <div><h2>Your orders</h2>{orders.length ? <div className="order-list">{orders.map((order) => <article className={order.order_number === highlightedOrder ? "order-card highlighted" : "order-card"} key={order.id}><div className="order-card-top"><div><small>ORDER</small><b>{order.order_number}</b></div><div><small>PLACED</small><b>{new Date(order.created_at).toLocaleDateString()}</b></div><div><small>TOTAL</small><b>{money(order.total)}</b></div><span className={`status-pill ${order.status}`}>{orderStatusLabel(order.status)}</span></div><div className="order-lines">{order.order_items?.map((item) => <div key={item.id}><span>{item.quantity} × {item.product_name}</span><b>{money(item.line_total)}</b></div>)}</div><div className="payment-instructions"><b>Payment: {orderStatusLabel(order.payment_method)}</b><span>{order.payment_method === "card" ? "A secure card invoice will be sent after order review." : "Payment instructions will be sent after order review."}</span><small>Price lock: {order.price_locked_until ? new Date(order.price_locked_until).toLocaleString() : "Pending"}</small></div></article>)}</div> : <div className="empty-state compact"><h3>No orders yet</h3><p>Your completed orders will appear here.</p><a className="button button-dark" href="/shop">Shop bullion</a></div>}</div> : <div><h2>Profile details</h2><form className="profile-form" onSubmit={saveProfile}><div className="form-row"><label>First name<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label><label>Last name<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label></div><label>Phone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label><label>Email<input disabled value={user.email} /></label>{message && <div className="form-message">{message}</div>}<button className="button button-gold">Save profile</button></form></div>}</div>
      </div>
    </div></section>
  );
}
