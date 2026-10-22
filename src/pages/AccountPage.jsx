import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Headphones, LockKeyhole, LogOut, MapPin, Package, ShieldCheck, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel } from "../lib/pricing";
import { useAuth } from "../state/AuthContext";
import { useCart } from "../state/CartContext";
import OrderReceipt, { OrderItems } from "../components/OrderReceipt";
import OrderStatus from "../components/OrderStatus";
import { clearCheckoutRecovery, readCheckoutRecovery } from "../lib/checkoutRecovery";

const orderFields = "id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, payment_provider, provider_checkout_url, payment_reference, payment_due_at, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number, created_at, updated_at, order_items(*, products(image_url, image_urls, slug, category))";
const tabs = [
  ["orders", Package, "Orders"],
  ["profile", UserRound, "Profile"],
  ["security", ShieldCheck, "Security"],
  ["support", Headphones, "Support"],
];

const emptyProfile = { first_name: "", last_name: "", phone: "", address_line_1: "", address_line_2: "", city: "", state: "", postal_code: "", marketing_opt_in: false };

export default function AccountPage() {
  const {
    user,
    profile,
    isAdmin,
    signOut,
    refreshProfile,
    customerSmsVerified,
    requiresCustomerMfa,
  } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { completePurchase } = useCart();
  const completePurchaseRef = useRef(completePurchase);
  const requestedTab = params.get("tab");
  const paymentResult = params.get("payment");
  const [active, setActive] = useState(tabs.some(([id]) => id === requestedTab) ? requestedTab : "orders");
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(emptyProfile);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const highlightedOrder = params.get("order");
  const autoShowWire = params.get("wire") === "show";
  const [paymentState, setPaymentState] = useState(
    paymentResult === "return" ? "checking" : paymentResult === "cancelled" ? "cancelled" : "none",
  );

  useEffect(() => {
    setActive(tabs.some(([id]) => id === requestedTab) ? requestedTab : "orders");
  }, [requestedTab]);
  useEffect(() => {
    completePurchaseRef.current = completePurchase;
  }, [completePurchase]);
  useEffect(() => {
    setForm({ ...emptyProfile, ...(profile || {}) });
  }, [profile]);
  useEffect(() => {
    let activeRequest = true;
    setLoading(true);
    setLoadError("");
    Promise.all([
      supabase.from("orders").select(orderFields).eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("support_tickets").select("id, ticket_number, subject, status, admin_response, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    ]).then(([orderResult, ticketResult]) => {
      if (!activeRequest) return;
      if (orderResult.error || ticketResult.error) setLoadError("Some account information could not be loaded. Please refresh and try again.");
      if (!orderResult.error) setOrders((current) => (orderResult.data || []).map((row) => {
        const prior = current.find((item) => item.id === row.id);
        return prior && new Date(prior.updated_at) > new Date(row.updated_at) ? prior : row;
      }));
      if (!ticketResult.error) setTickets(ticketResult.data || []);
      setLoading(false);
    }).catch(() => { if(activeRequest) { setLoadError("Your account connection was interrupted. Please refresh and try again."); setLoading(false); } });
    return () => { activeRequest = false; };
  }, [user.id, refreshCount]);
  useEffect(() => {
    if (paymentResult !== "return" || !highlightedOrder) { setPaymentState("none"); return undefined; }
    let activeRequest = true;
    let timer;
    setPaymentState("checking");

    const confirmPayment = async (attempt = 0) => {
      try {
        const { data, error } = await supabase.from("orders").select(orderFields)
          .eq("user_id", user.id).eq("order_number", highlightedOrder).maybeSingle();
        if (!activeRequest) return;
        if (error) throw error;
        if (data) setOrders((current) => {
          const prior = current.find((order) => order.id === data.id);
          if (prior && new Date(prior.updated_at) > new Date(data.updated_at)) return current;
          return prior ? current.map((order) => order.id === data.id ? data : order) : [data, ...current];
        });
        if (data?.payment_status === "paid") {
          const recovery = readCheckoutRecovery();
          if (recovery?.orderNumber === highlightedOrder) {
            clearCheckoutRecovery(highlightedOrder);
            completePurchaseRef.current(recovery.items);
          }
          setPaymentState("paid"); return;
        }
        if (!data || data.status === "cancelled" || ["failed","expired","refunded","disputed"].includes(data.payment_status)) {
          setPaymentState("pending"); return;
        }
      } catch {
        if (!activeRequest) return;
      }
      if (attempt < 8) timer = window.setTimeout(() => confirmPayment(attempt + 1), 1250);
      else setPaymentState("pending");
    };
    confirmPayment();
    return () => {
      activeRequest = false;
      window.clearTimeout(timer);
    };
  }, [paymentResult, highlightedOrder, user.id, refreshCount]);

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

  if (highlightedOrder && active === "orders") {
    const order = orders.find((item) => item.order_number === highlightedOrder);
    const canPay = order && !["cancelled", "shipped", "completed"].includes(order.status)
      && ["unpaid", "failed", "expired", "partially_paid"].includes(order.payment_status);
    return <section className="section account-section"><div className="container">
      {order ? <OrderReceipt order={order} checking={paymentState === "checking"} refreshing={loading} error={loadError} onRefresh={() => setRefreshCount((count) => count + 1)}>
        {order.payment_method === "wire" && !["paid", "refunded", "disputed"].includes(order.payment_status) && order.status !== "cancelled"
          ? <><p className="field-help">Reference: <b>{order.payment_reference || order.order_number}</b>{order.payment_due_at && <><br />Due {new Date(order.payment_due_at).toLocaleString()}</>}</p><PaymentAction order={order} autoOpen={autoShowWire} /></>
          : canPay && paymentState !== "checking" ? <PaymentAction order={order} /> : null}
      </OrderReceipt> : loading ? <div className="catalog-loading" role="status">Loading your order details…</div>
      : <div className="empty-state"><Package /><h1>Order details unavailable</h1><p>We couldn’t load this order for your account. Refresh to try again or return to your order history.</p><button className="button button-gold" onClick={() => setRefreshCount((count) => count + 1)}>Try again</button><Link className="button button-outline" to="/account?tab=orders">All orders</Link></div>}
    </div></section>;
  }

  return <section className="section account-section"><div className="container">
    <div className="account-header"><div><span className="eyebrow dark">CUSTOMER ACCOUNT</span><h1>Welcome{profile?.first_name ? `, ${profile.first_name}` : ""}</h1><p>{user.email}</p></div><div>{isAdmin && <Link className="button button-dark" to="/admin">Open admin dashboard</Link>}<button className="button button-outline" onClick={doSignOut}><LogOut /> Sign out</button></div></div>
    <div className="account-snapshot"><div><b>{totals.orders}</b><span>Total orders</span></div><div><b>{totals.open}</b><span>Open orders</span></div><div><b>{totals.tickets}</b><span>Open support requests</span></div><div><b>{user.email_confirmed_at ? "Verified" : "Pending"}</b><span>Email status</span></div></div>
    {loadError && <div className="form-message error">{loadError}</div>}
    <div className="account-layout"><aside className="account-nav">{tabs.map(([id, Icon, label]) => <button key={id} className={active === id ? "active" : ""} onClick={() => selectTab(id)}><Icon /> {label}</button>)}</aside>
      <div className="account-content">
        {active === "orders" && <OrdersPanel orders={orders} loading={loading} highlightedOrder={highlightedOrder} autoShowWire={autoShowWire} />}
        {active === "profile" && <div><div className="account-panel-heading"><div><h2>Profile and delivery</h2><p>Keep your contact and default shipping details ready for checkout.</p></div><MapPin /></div><form className="profile-form" onSubmit={saveProfile}><div className="form-row"><label>First name<input required maxLength="60" autoComplete="given-name" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label><label>Last name<input required maxLength="60" autoComplete="family-name" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label></div><div className="form-row"><label>Phone<input type="tel" maxLength="30" autoComplete="tel" value={form.phone || ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Verified email<input disabled value={user.email} /></label></div><div className="profile-address"><h3>Default insured-delivery address</h3><label>Street address<input maxLength="160" autoComplete="address-line1" value={form.address_line_1 || ""} onChange={(event) => setForm({ ...form, address_line_1: event.target.value })} /></label><label>Apartment, suite, etc.<input maxLength="100" autoComplete="address-line2" value={form.address_line_2 || ""} onChange={(event) => setForm({ ...form, address_line_2: event.target.value })} /></label><div className="form-row three"><label>City<input maxLength="80" autoComplete="address-level2" value={form.city || ""} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label><label>State<input maxLength="2" autoComplete="address-level1" value={form.state || ""} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></label><label>ZIP code<input maxLength="10" autoComplete="postal-code" value={form.postal_code || ""} onChange={(event) => setForm({ ...form, postal_code: event.target.value })} /></label></div></div><label className="profile-check"><input type="checkbox" checked={Boolean(form.marketing_opt_in)} onChange={(event) => setForm({ ...form, marketing_opt_in: event.target.checked })} /> Send occasional inventory and market updates</label>{message && <div className="form-message">{message}</div>}<button className="button button-gold" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></form></div>}
        {active === "security" && <div><div className="account-panel-heading"><div><h2>Account security</h2><p>Protect access to order and delivery information.</p></div><ShieldCheck /></div><div className="security-card"><LockKeyhole /><div><b>Password</b><p>Use a unique password with at least 12 characters. A reset link is sent only to your verified email.</p><button className="button button-dark" onClick={sendPasswordReset} disabled={busy}>{busy ? "Sending…" : "Send password-reset link"}</button></div></div><div className="security-facts"><div><span>Email verification</span><b>{user.email_confirmed_at ? "Verified" : "Confirmation required"}</b></div><div><span>SMS identity protection</span><b>{customerSmsVerified ? "Verified for this sign-in" : requiresCustomerMfa ? "Required" : "Rollout pending"}</b></div><div><span>Last sign-in</span><b>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Not available"}</b></div><div><span>Account identifier</span><b>{user.id.slice(0, 8).toUpperCase()}</b></div></div>{requiresCustomerMfa && !customerSmsVerified && <Link className="button button-gold" to="/verify-phone?return=/account?tab=security">Set up SMS security</Link>}{message && <div className="form-message">{message}</div>}<div className="security-warning"><b>GoldOnTheSpot will never ask for your password or security code.</b><span>Do not send card numbers, banking passwords, or verification codes through chat, email, or support tickets.</span></div></div>}
        {active === "support" && <div><div className="account-panel-heading"><div><h2>Private support</h2><p>Your latest requests and replies.</p></div><Headphones /></div>{tickets.length ? <div className="account-ticket-list">{tickets.map((ticket) => <article key={ticket.id}><div><small>{ticket.ticket_number}</small><b>{ticket.subject}</b><span>{new Date(ticket.created_at).toLocaleDateString()}</span></div><span className={`ticket-status ${ticket.status}`}>{ticket.status.replace("_", " ")}</span>{ticket.admin_response && <p><b>Response:</b> {ticket.admin_response}</p>}</article>)}</div> : <div className="empty-state compact"><h3>No support requests yet</h3><p>Use private support when you need help with a product, payment, shipment, or account.</p></div>}<Link className="button button-gold" to="/support">Open support center</Link></div>}
      </div>
    </div>
  </div></section>;
}

function OrdersPanel({ orders, loading, highlightedOrder, autoShowWire }) {
  if (loading) return <div className="catalog-loading">Loading your secure order history…</div>;
  return <div><div className="account-panel-heading"><div><h2>Your orders</h2><p>Payment, fulfillment, and tracking in one place.</p></div><Package /></div>{orders.length ? <div className="order-list">{orders.map((order) => <article className={order.order_number === highlightedOrder ? "order-card highlighted" : "order-card"} key={order.id}><div className="order-card-top"><div><small>ORDER</small><b>{order.order_number}</b></div><div><small>PLACED</small><b>{new Date(order.created_at).toLocaleDateString()}</b></div><div><small>TOTAL</small><b>{money(order.total)}</b></div><OrderStatus order={order} /></div><OrderItems items={order.order_items || []} /><div className="order-detail-link"><Link className="button button-outline" to={`/account?tab=orders&order=${encodeURIComponent(order.order_number)}`}>View full order</Link></div><div className="order-total-breakdown"><span>Items {money(order.subtotal)}</span><span>Shipping {Number(order.shipping_amount) ? money(order.shipping_amount) : "Free"}</span>{Number(order.payment_surcharge) > 0 && <span>Card surcharge {money(order.payment_surcharge)}</span>}<b>Total {money(order.total)}</b></div><div className="payment-instructions"><b>Payment: {orderStatusLabel(order.payment_method)} • {orderStatusLabel(order.payment_status)}</b><span>{order.payment_method === "wire" ? `Use reference ${order.payment_reference || order.order_number}. Open the secure instructions below. Check your email for order updates.` : order.payment_method === "card" ? "Card details are entered securely on GoldOnTheSpot using Stripe's encrypted fields." : "Crypto payment is completed on NOWPayments' secure hosted checkout."}</span>{order.payment_method === "wire" && order.payment_due_at && <span>Wire due: <b>{new Date(order.payment_due_at).toLocaleString()}</b></span>}{!["cancelled","shipped","completed"].includes(order.status) && ["unpaid","failed","expired","partially_paid"].includes(order.payment_status) && <PaymentAction order={order} autoOpen={autoShowWire && order.order_number === highlightedOrder} />}{order.tracking_number && <strong>Tracking: {order.tracking_number}</strong>}<small>Price lock recorded: {order.price_locked_until ? new Date(order.price_locked_until).toLocaleString() : "Pending"}</small></div></article>)}</div> : <div className="empty-state compact"><h3>No orders yet</h3><p>Your placed orders will appear here immediately.</p><Link className="button button-dark" to="/shop">Shop bullion</Link></div>}</div>;
}

function PaymentAction({ order, autoOpen = false }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [wire, setWire] = useState(null);
  const autoOpened = useRef(false);
  const act = async () => {
    setBusy(true); setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || "";
      if (order.payment_method === "wire") {
        const response = await fetch(`/api/payments/wire-instructions?order_id=${order.id}`, { headers: { authorization: `Bearer ${token}` } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setWire(result);
      } else {
        const response = await fetch("/api/payments/create-checkout", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ order_id: order.id }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.url) window.location.assign(result.url);
      }
    } catch (error) { setMessage(error.message || "Payment is temporarily unavailable."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!autoOpen || autoOpened.current || order.payment_method !== "wire") return;
    autoOpened.current = true;
    act();
  }, [autoOpen, order.payment_method]);
  return <div className="order-payment-action"><button className="button button-dark" type="button" onClick={act} disabled={busy}>{busy ? "Opening securely…" : order.payment_method === "wire" ? "View wire instructions" : `Pay with ${order.payment_method === "card" ? "card" : "crypto"}`}</button>{message && <small className="form-message error">{message}</small>}{wire && <div className="wire-instructions"><h3>Send your bank wire</h3><p>Please arrange a USD bank wire using these details. Do not send an ACH transfer or check.</p><b>{wire.instructions.bank_name}</b><span>Beneficiary: {wire.instructions.beneficiary_name}</span><span>Domestic wire routing (ABA): {wire.instructions.routing_number}</span><span>Account: {wire.instructions.account_number}</span>{wire.instructions.swift_code && <span>SWIFT / BIC (international wires only): {wire.instructions.swift_code}</span>}{wire.instructions.bank_address && <span>Bank address: {wire.instructions.bank_address}</span>}<strong>Reference: {wire.reference}</strong><strong>Send exactly {money(wire.total)} USD</strong>{wire.due_at && <span>Payment due: {new Date(wire.due_at).toLocaleString("en-US", {timeZone:"America/New_York",timeZoneName:"short"})}</span>}{wire.instructions.notes && <small>{wire.instructions.notes}</small>}<small>Include the reference exactly. Any bank fees must be paid separately so the full order amount reaches us. Orders ship only after cleared funds and review. Compare emailed instructions with this signed-in page; contact support if they differ.</small>{wire.agreement && <details><summary>Accepted bank-wire agreement</summary><p>{wire.agreement.text}</p><small>Version {wire.agreement.version} · Accepted {new Date(wire.agreement.accepted_at).toLocaleString()}</small></details>}</div>}</div>;
}
