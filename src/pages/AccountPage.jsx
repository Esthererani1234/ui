import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Headphones, LockKeyhole, LogOut, MapPin, Package, ShieldCheck, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel } from "../lib/pricing";
import { useAuth } from "../state/AuthContext";

const orderFields = "id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number, created_at, updated_at, order_items(*)";
const tabs = [
  ["orders", Package, "Orders"],
  ["profile", UserRound, "Profile"],
  ["security", ShieldCheck, "Security"],
  ["support", Headphones, "Support"],
];

const emptyProfile = { first_name: "", last_name: "", phone: "", address_line_1: "", address_line_2: "", city: "", state: "", postal_code: "", marketing_opt_in: false };

export default function AccountPage() {
  const { user, profile, isAdmin, signOut, refreshProfile } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requestedTab = params.get("tab");
  const [active, setActive] = useState(tabs.some(([id]) => id === requestedTab) ? requestedTab : "orders");
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(emptyProfile);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const highlightedOrder = params.get("order");

  useEffect(() => {
    setActive(tabs.some(([id]) => id === requestedTab) ? requestedTab : "orders");
  }, [requestedTab]);
  useEffect(() => {
    setForm({ ...emptyProfile, ...(profile || {}) });
  }, [profile]);
  useEffect(() => {
    let activeRequest = true;
    setLoading(true);
    Promise.all([
      supabase.from("orders").select(orderFields).eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("support_tickets").select("id, ticket_number, subject, status, admin_response, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    ]).then(([orderResult, ticketResult]) => {
      if (!activeRequest) return;
      if (orderResult.error || ticketResult.error) setLoadError("Some account information could not be loaded. Please refresh and try again.");
      setOrders(orderResult.data || []); setTickets(ticketResult.data || []); setLoading(false);
    });
    return () => { activeRequest = false; };
  }, [user.id]);

  const totals = useMemo(() => ({ orders: orders.length, open: orders.filter((order) => !["completed", "cancelled"].includes(order.status)).length, tickets: tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length }), [orders, tickets]);

  const selectTab = (tab) => {
    setActive(tab); setMessage("");
    navigate(`/account?tab=${tab}`, { replace: true });
  };
  const saveProfile = async (event) => {
    event.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return setMessage("First and last name are required.");
    setBusy(true); setMessage("");
    const payload = { first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim() || null, address_line_1: form.address_line_1.trim() || null, address_line_2: form.address_line_2.trim() || null, city: form.city.trim() || null, state: form.state.trim().toUpperCase() || null, postal_code: form.postal_code.trim() || null, marketing_opt_in: Boolean(form.marketing_opt_in) };
    const { error } = await supabase.from("profiles").update(payload).eq("id", user.id);
    setBusy(false);
    setMessage(error ? "We could not save your profile. Please check the fields and try again." : "Profile and delivery preferences saved.");
    if (!error) await refreshProfile();
  };
  const sendPasswordReset = async () => {
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/login?recovery=1` });
    setBusy(false);
    setMessage(error ? "We could not send the reset link. Wait a few minutes and try again." : "A secure password-reset link was sent to your email.");
  };
  const doSignOut = async () => { await signOut(); navigate("/"); };

  return <section className="section account-section"><div className="container">
    {highlightedOrder && <div className="success-banner"><CheckCircle2 /><div><b>Order {highlightedOrder} was placed successfully.</b><span>The exact server-calculated total and current status appear below.</span></div></div>}
    <div className="account-header"><div><span className="eyebrow dark">CUSTOMER ACCOUNT</span><h1>Welcome{profile?.first_name ? `, ${profile.first_name}` : ""}</h1><p>{user.email}</p></div><div>{isAdmin && <Link className="button button-dark" to="/admin">Open admin dashboard</Link>}<button className="button button-outline" onClick={doSignOut}><LogOut /> Sign out</button></div></div>
    <div className="account-snapshot"><div><b>{totals.orders}</b><span>Total orders</span></div><div><b>{totals.open}</b><span>Open orders</span></div><div><b>{totals.tickets}</b><span>Open support requests</span></div><div><b>{user.email_confirmed_at ? "Verified" : "Pending"}</b><span>Email status</span></div></div>
    {loadError && <div className="form-message error">{loadError}</div>}
    <div className="account-layout"><aside className="account-nav">{tabs.map(([id, Icon, label]) => <button key={id} className={active === id ? "active" : ""} onClick={() => selectTab(id)}><Icon /> {label}</button>)}</aside>
      <div className="account-content">
        {active === "orders" && <OrdersPanel orders={orders} loading={loading} highlightedOrder={highlightedOrder} />}
        {active === "profile" && <div><div className="account-panel-heading"><div><h2>Profile and delivery</h2><p>Keep your contact and default shipping details ready for checkout.</p></div><MapPin /></div><form className="profile-form" onSubmit={saveProfile}><div className="form-row"><label>First name<input required maxLength="60" autoComplete="given-name" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label><label>Last name<input required maxLength="60" autoComplete="family-name" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label></div><div className="form-row"><label>Phone<input type="tel" maxLength="30" autoComplete="tel" value={form.phone || ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Verified email<input disabled value={user.email} /></label></div><div className="profile-address"><h3>Default insured-delivery address</h3><label>Street address<input maxLength="160" autoComplete="address-line1" value={form.address_line_1 || ""} onChange={(event) => setForm({ ...form, address_line_1: event.target.value })} /></label><label>Apartment, suite, etc.<input maxLength="100" autoComplete="address-line2" value={form.address_line_2 || ""} onChange={(event) => setForm({ ...form, address_line_2: event.target.value })} /></label><div className="form-row three"><label>City<input maxLength="80" autoComplete="address-level2" value={form.city || ""} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label><label>State<input maxLength="2" autoComplete="address-level1" value={form.state || ""} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></label><label>ZIP code<input maxLength="10" autoComplete="postal-code" value={form.postal_code || ""} onChange={(event) => setForm({ ...form, postal_code: event.target.value })} /></label></div></div><label className="profile-check"><input type="checkbox" checked={Boolean(form.marketing_opt_in)} onChange={(event) => setForm({ ...form, marketing_opt_in: event.target.checked })} /> Send occasional inventory and market updates</label>{message && <div className="form-message">{message}</div>}<button className="button button-gold" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></form></div>}
        {active === "security" && <div><div className="account-panel-heading"><div><h2>Account security</h2><p>Protect access to order and delivery information.</p></div><ShieldCheck /></div><div className="security-card"><LockKeyhole /><div><b>Password</b><p>Use a unique password with at least 12 characters. A reset link is sent only to your verified email.</p><button className="button button-dark" onClick={sendPasswordReset} disabled={busy}>{busy ? "Sending…" : "Send password-reset link"}</button></div></div><div className="security-facts"><div><span>Email verification</span><b>{user.email_confirmed_at ? "Verified" : "Confirmation required"}</b></div><div><span>Last sign-in</span><b>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Not available"}</b></div></div>{message && <div className="form-message">{message}</div>}<div className="security-warning"><b>GoldOnTheSpot will never ask for your password or authenticator code.</b><span>Do not send card numbers, banking passwords, or verification codes through chat, email, or support tickets.</span></div></div>}
        {active === "support" && <div><div className="account-panel-heading"><div><h2>Private support</h2><p>Your latest requests and replies.</p></div><Headphones /></div>{tickets.length ? <div className="account-ticket-list">{tickets.map((ticket) => <article key={ticket.id}><div><small>{ticket.ticket_number}</small><b>{ticket.subject}</b><span>{new Date(ticket.created_at).toLocaleDateString()}</span></div><span className={`ticket-status ${ticket.status}`}>{ticket.status.replace("_", " ")}</span>{ticket.admin_response && <p><b>Response:</b> {ticket.admin_response}</p>}</article>)}</div> : <div className="empty-state compact"><h3>No support requests yet</h3><p>Use private support when you need help with a product, payment, shipment, or account.</p></div>}<Link className="button button-gold" to="/support">Open support center</Link></div>}
      </div>
    </div>
  </div></section>;
}

function OrdersPanel({ orders, loading, highlightedOrder }) {
  if (loading) return <div className="catalog-loading">Loading your secure order history…</div>;
  return <div><div className="account-panel-heading"><div><h2>Your orders</h2><p>Payment, fulfillment, and tracking in one place.</p></div><Package /></div>{orders.length ? <div className="order-list">{orders.map((order) => <article className={order.order_number === highlightedOrder ? "order-card highlighted" : "order-card"} key={order.id}><div className="order-card-top"><div><small>ORDER</small><b>{order.order_number}</b></div><div><small>PLACED</small><b>{new Date(order.created_at).toLocaleDateString()}</b></div><div><small>TOTAL</small><b>{money(order.total)}</b></div><span className={`status-pill ${order.status}`}>{orderStatusLabel(order.status)}</span></div><div className="order-lines">{order.order_items?.map((item) => <div key={item.id}><span>{item.quantity} × {item.product_name}</span><b>{money(item.line_total)}</b></div>)}</div><div className="order-total-breakdown"><span>Items {money(order.subtotal)}</span><span>Shipping {Number(order.shipping_amount) ? money(order.shipping_amount) : "Free"}</span>{Number(order.payment_surcharge) > 0 && <span>Card surcharge {money(order.payment_surcharge)}</span>}<b>Total {money(order.total)}</b></div><div className="payment-instructions"><b>Payment: {orderStatusLabel(order.payment_method)} • {orderStatusLabel(order.payment_status)}</b><span>{order.payment_method === "card" ? "A secure card invoice will be sent after order review." : "Payment instructions will be sent after order review."}</span>{order.tracking_number && <strong>Tracking: {order.tracking_number}</strong>}<small>Price lock recorded: {order.price_locked_until ? new Date(order.price_locked_until).toLocaleString() : "Pending"}</small></div></article>)}</div> : <div className="empty-state compact"><h3>No orders yet</h3><p>Your placed orders will appear here immediately.</p><Link className="button button-dark" to="/shop">Shop bullion</Link></div>}</div>;
}
