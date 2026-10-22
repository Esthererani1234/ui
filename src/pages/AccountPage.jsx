import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Headphones, LockKeyhole, LogOut, Mail, MapPin, Package, Plus, RefreshCw, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel } from "../lib/pricing";
import { useAuth } from "../state/AuthContext";
import { useCart } from "../state/CartContext";
import OrderReceipt, { OrderItems } from "../components/OrderReceipt";
import OrderStatus from "../components/OrderStatus";
import CustomerAccountNav from "../components/CustomerAccountNav";
import { clearCheckoutRecovery, readCheckoutRecovery } from "../lib/checkoutRecovery";
import "../styles/customerAccount.css";

const orderFields = "id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, payment_provider, provider_checkout_url, payment_reference, payment_due_at, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number, created_at, updated_at, order_items(*, products(image_url, image_urls, slug, category))";
const tabs = ["orders", "profile", "security", "support"];

const emptyProfile = { first_name: "", last_name: "", address_line_1: "", address_line_2: "", city: "", state: "", postal_code: "", marketing_opt_in: false };

const profileForm = (profile) => Object.fromEntries(Object.keys(emptyProfile).map(key => [key,
  key === "marketing_opt_in" ? Boolean(profile?.[key]) : typeof profile?.[key] === "string" ? profile[key] : "",
]));
const ticketStatuses = { open: "Awaiting support", in_progress: "Being reviewed", resolved: "Answered", closed: "Closed" };

export default function AccountPage() {
  const {
    user,
    profile,
    isAdmin,
    signOut,
    refreshProfile,
    customerSmsVerified,
    customerSmsPhone,
    requiresCustomerMfa,
  } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { completePurchase } = useCart();
  const completePurchaseRef = useRef(completePurchase);
  const requestedTab = params.get("tab");
  const paymentResult = params.get("payment");
  const active = tabs.includes(requestedTab) ? requestedTab : "orders";
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState("");
  const [ticketRefreshCount, setTicketRefreshCount] = useState(0);
  const ownedProfile = profile?.id === user.id ? profile : null;
  const [form, setForm] = useState(() => profileForm(ownedProfile));
  const [profileNotice, setProfileNotice] = useState(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [securityNotice, setSecurityNotice] = useState(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const currentUser = useRef(user.id), mounted = useRef(true), dirty = useRef(false);
  const profileRequest = useRef(null), securityRequest = useRef(null), signOutRequest = useRef(null);
  currentUser.current = user.id;
  const isCurrent = owner => mounted.current && currentUser.current === owner;
  const highlightedOrder = params.get("order");
  const autoShowWire = params.get("wire") === "show";
  const [paymentState, setPaymentState] = useState(
    paymentResult === "return" ? "checking" : paymentResult === "cancelled" ? "cancelled" : "none",
  );

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    completePurchaseRef.current = completePurchase;
  }, [completePurchase]);
  useEffect(() => {
    dirty.current = false;
    setForm(profileForm(ownedProfile));
    setProfileNotice(null); setSecurityNotice(null); setSignOutError("");
    setProfileBusy(false); setSecurityBusy(false); setSigningOut(false);
    profileRequest.current = null; securityRequest.current = null; signOutRequest.current = null;
    setOrders([]); setTickets([]);
  }, [user.id]);
  useEffect(() => {
    if (profile?.id === user.id && !dirty.current) setForm(profileForm(profile));
  }, [profile, user.id]);
  useEffect(() => {
    let activeRequest = true;
    const owner = user.id;
    setLoading(true); setLoadError("");
    async function loadOrders() {
      try {
        const { data, error } = await supabase.from("orders").select(orderFields).eq("user_id", owner).order("created_at", { ascending: false });
        if (!activeRequest || !isCurrent(owner)) return;
        if (error) throw error;
        setOrders(current => (data || []).map(row => {
          const prior = current.find(item => item.id === row.id);
          return prior && new Date(prior.updated_at) > new Date(row.updated_at) ? prior : row;
        }));
      } catch {
        if (activeRequest && isCurrent(owner)) setLoadError("Your orders could not be loaded. Please try again.");
      } finally {
        if (activeRequest && isCurrent(owner)) setLoading(false);
      }
    }
    loadOrders();
    return () => { activeRequest = false; };
  }, [user.id, refreshCount]);
  useEffect(() => {
    let activeRequest = true;
    const owner = user.id;
    setTicketsLoading(true); setTicketsError("");
    async function loadTickets() {
      try {
        const { data, error } = await supabase.from("support_tickets").select("id,ticket_number,subject,status,created_at,updated_at").eq("user_id", owner).order("updated_at", { ascending: false }).limit(5);
        if (!activeRequest || !isCurrent(owner)) return;
        if (error) throw error;
        setTickets(data || []);
      } catch {
        if (activeRequest && isCurrent(owner)) setTicketsError("Your support requests could not be loaded. Please try again.");
      } finally {
        if (activeRequest && isCurrent(owner)) setTicketsLoading(false);
      }
    }
    loadTickets();
    return () => { activeRequest = false; };
  }, [user.id, ticketRefreshCount]);
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

  const changeField = (name, value) => {
    dirty.current = true;
    setForm(current => ({ ...current, [name]: value }));
    setProfileNotice(null);
  };
  const saveProfile = async (event) => {
    event.preventDefault();
    if (profileRequest.current || !ownedProfile) return;
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setProfileNotice({ error: true, text: "First and last name are required." });
      event.currentTarget.elements.namedItem(!form.first_name.trim() ? "first_name" : "last_name")?.focus();
      return;
    }
    const owner = user.id, operation = Symbol("profile-save");
    profileRequest.current = operation;
    setProfileBusy(true); setProfileNotice(null);
    // Phone enrollment is separate. Saving a name/address must never replace it.
    const payload = { first_name: form.first_name.trim(), last_name: form.last_name.trim(), address_line_1: form.address_line_1.trim() || null, address_line_2: form.address_line_2.trim() || null, city: form.city.trim() || null, state: form.state.trim().toUpperCase() || null, postal_code: form.postal_code.trim() || null, marketing_opt_in: Boolean(form.marketing_opt_in) };
    try {
      const { data, error } = await supabase.from("profiles").update(payload).eq("id", owner).select("id").maybeSingle();
      if (!isCurrent(owner)) return;
      if (error || data?.id !== owner) throw new Error("Profile save was not confirmed.");
      dirty.current = false;
      setForm(profileForm(payload));
      setProfileNotice({ text: "Your profile and delivery address are saved." });
      try { await refreshProfile(); }
      catch { if (isCurrent(owner)) setProfileNotice({ text: "Your changes are saved. Refresh the page to reload your account details." }); }
    } catch {
      if (isCurrent(owner)) setProfileNotice({ error: true, text: "We couldn’t save your profile. Your changes are still here. Please try again." });
    } finally {
      if (isCurrent(owner) && profileRequest.current === operation) { profileRequest.current = null; setProfileBusy(false); }
    }
  };
  const reloadProfile = async () => {
    if (profileRequest.current) return;
    const owner = user.id, operation = Symbol("profile-reload");
    profileRequest.current = operation; setProfileBusy(true); setProfileNotice(null);
    try { await refreshProfile(); }
    catch { if (isCurrent(owner)) setProfileNotice({ error: true, text: "Your profile could not be loaded. Please try again." }); }
    finally { if (isCurrent(owner) && profileRequest.current === operation) { profileRequest.current = null; setProfileBusy(false); } }
  };
  const sendPasswordReset = async () => {
    if (securityRequest.current) return;
    const owner = user.id, operation = Symbol("password-reset");
    securityRequest.current = operation; setSecurityBusy(true); setSecurityNotice(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/login?recovery=1` });
      if (!isCurrent(owner)) return;
      if (error) throw error;
      setSecurityNotice({ text: "A password-reset link was sent to your email. Check your inbox to continue." });
    } catch {
      if (isCurrent(owner)) setSecurityNotice({ error: true, text: "We couldn’t send the reset link. Please wait a moment and try again." });
    } finally {
      if (isCurrent(owner) && securityRequest.current === operation) { securityRequest.current = null; setSecurityBusy(false); }
    }
  };
  const doSignOut = async () => {
    if (signOutRequest.current) return;
    const owner = user.id, operation = Symbol("sign-out");
    signOutRequest.current = operation; setSigningOut(true); setSignOutError("");
    try {
      const result = await signOut();
      if (result?.error) throw result.error;
      if (isCurrent(owner)) navigate("/");
    } catch {
      if (isCurrent(owner)) setSignOutError("We couldn’t sign you out. Please try again.");
    } finally {
      if (isCurrent(owner) && signOutRequest.current === operation) { signOutRequest.current = null; setSigningOut(false); }
    }
  };

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

  return <section className="customer-account"><div className="container">
    <header className="customer-account-header"><div><span className="eyebrow dark">GOLD ON THE SPOT</span><h1>Your account</h1><p>Orders, personal details, and help when you need it.</p></div><div className="customer-account-actions"><Link to="/shop"><ArrowLeft size={16} aria-hidden="true" /> Back to shop</Link>{isAdmin && <Link to="/admin">Admin dashboard</Link>}<button type="button" onClick={doSignOut} disabled={signingOut}><LogOut size={16} aria-hidden="true" /> {signingOut ? "Signing out…" : "Sign out"}</button></div></header>
    {signOutError && <div className="form-message error" role="alert">{signOutError}</div>}
    <CustomerAccountNav active={active} />
    <div className="customer-account-panel">
      {active === "orders" && <>
        <div className="customer-account-toolbar"><span>Order history</span><button type="button" className="customer-account-refresh" disabled={loading} onClick={() => setRefreshCount(count => count + 1)}><RefreshCw size={15} aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh orders"}</button></div>
        {loadError && <div className="form-message error" role="alert">{loadError}<button type="button" className="text-button" disabled={loading} onClick={() => setRefreshCount(count => count + 1)}>Try again</button></div>}
        {(!loadError || orders.length > 0 || loading) && <OrdersPanel orders={orders} loading={loading} highlightedOrder={highlightedOrder} autoShowWire={autoShowWire} />}
      </>}
      {active === "profile" && <>
        <header className="customer-panel-heading"><h2>Your details</h2><p>Keep your name and delivery address ready for your next order.</p></header>
        {!ownedProfile && <div className="form-message error" role="alert">Your profile could not be loaded. Reload it before making changes.<button type="button" className="text-button" disabled={profileBusy} onClick={reloadProfile}>{profileBusy ? "Loading…" : "Reload profile"}</button></div>}
        <div className="customer-profile-layout">
          <form className="profile-form" onSubmit={saveProfile} noValidate aria-busy={profileBusy}>
            <fieldset disabled={profileBusy || !ownedProfile} className="customer-profile-fields">
              <section className="customer-profile-section" aria-labelledby="profile-personal-heading"><h3 id="profile-personal-heading"><UserRound size={18} aria-hidden="true" /> Personal details</h3><div className="form-row"><label>First name<input name="first_name" required maxLength={60} autoComplete="given-name" value={form.first_name} onChange={event => changeField("first_name", event.target.value)} /></label><label>Last name<input name="last_name" required maxLength={60} autoComplete="family-name" value={form.last_name} onChange={event => changeField("last_name", event.target.value)} /></label></div></section>
              <section className="customer-profile-section" aria-labelledby="profile-address-heading"><h3 id="profile-address-heading"><MapPin size={18} aria-hidden="true" /> Default delivery address</h3><p>Used to prefill checkout. Existing orders keep their original delivery address.</p><label>Street address<input maxLength={160} autoComplete="address-line1" value={form.address_line_1} onChange={event => changeField("address_line_1", event.target.value)} /></label><label>Apartment, suite, etc. <span>(optional)</span><input maxLength={100} autoComplete="address-line2" value={form.address_line_2} onChange={event => changeField("address_line_2", event.target.value)} /></label><div className="form-row three"><label>City<input maxLength={80} autoComplete="address-level2" value={form.city} onChange={event => changeField("city", event.target.value)} /></label><label>State<input maxLength={2} autoComplete="address-level1" value={form.state} onChange={event => changeField("state", event.target.value.toUpperCase())} /></label><label>ZIP code<input maxLength={10} autoComplete="postal-code" value={form.postal_code} onChange={event => changeField("postal_code", event.target.value)} /></label></div></section>
              <label className="profile-check"><input type="checkbox" checked={form.marketing_opt_in} onChange={event => changeField("marketing_opt_in", event.target.checked)} /><span>Send occasional inventory and market updates</span></label>
            </fieldset>
            {profileNotice && <div className={`form-message ${profileNotice.error ? "error" : "success"}`} role={profileNotice.error ? "alert" : "status"}>{profileNotice.text}</div>}
            <div className="customer-profile-save"><button type="submit" className="button button-gold" disabled={profileBusy || !ownedProfile}>{profileBusy ? "Saving…" : "Save changes"}</button><span>Changes apply to this account.</span></div>
          </form>
          <aside className="customer-contact-panel" aria-labelledby="profile-contact-heading"><h3 id="profile-contact-heading">Contact & sign-in</h3><dl><div><dt><Mail size={15} aria-hidden="true" /> Email address</dt><dd>{user.email}</dd><small>{user.email_confirmed_at ? "Verified email" : "Email confirmation required"}</small></div><div><dt><Smartphone size={15} aria-hidden="true" /> Mobile number</dt><dd>{customerSmsPhone || ownedProfile?.phone || "Not added"}</dd><small>Your security phone is managed separately from your delivery details.</small></div></dl><Link className="customer-inline-link" to="/support?new=1&category=account">Request phone change <ArrowRight size={15} aria-hidden="true" /></Link><Link className="customer-inline-link" to="/account?tab=security">Password & security <ArrowRight size={15} aria-hidden="true" /></Link></aside>
        </div>
      </>}
      {active === "security" && <>
        <header className="customer-panel-heading"><h2>Password & security</h2><p>Manage access to your account.</p></header>
        <div className="customer-security-grid"><section className="customer-security-card"><span className="customer-security-icon"><LockKeyhole aria-hidden="true" /></span><h3>Reset your password</h3><p>We’ll send a secure reset link to <b>{user.email}</b>.</p><button type="button" className="button button-dark" onClick={sendPasswordReset} disabled={securityBusy}>{securityBusy ? "Sending…" : "Send password-reset link"}</button>{securityNotice && <div className={`form-message ${securityNotice.error ? "error" : "success"}`} role={securityNotice.error ? "alert" : "status"}>{securityNotice.text}</div>}</section><section className="customer-security-card"><span className="customer-security-icon"><ShieldCheck aria-hidden="true" /></span><h3>Phone verification</h3><p className="customer-verification-status">{customerSmsVerified ? <CheckCircle2 size={17} aria-hidden="true" /> : <Smartphone size={17} aria-hidden="true" />} {customerSmsVerified ? "Verified for this sign-in" : requiresCustomerMfa ? "Verification required" : "Not currently required"}</p><p>SMS verification helps protect your account and order details.</p>{requiresCustomerMfa && !customerSmsVerified ? <Link className="button button-gold" to="/verify-phone?return=%2Faccount%3Ftab%3Dsecurity">Set up SMS security</Link> : <Link className="customer-inline-link" to="/support?new=1&category=account">Need help with your phone? <ArrowRight size={15} aria-hidden="true" /></Link>}</section></div>
        <p className="customer-security-note"><ShieldCheck size={16} aria-hidden="true" /> Our team will never ask for your password or security code.</p>
      </>}
      {active === "support" && <>
        <header className="customer-panel-heading customer-support-heading"><div><h2>Your support requests</h2><p>Open a request to read the conversation and reply.</p></div><Link className="button button-gold" to="/support?new=1"><Plus size={16} aria-hidden="true" /> New support request</Link></header>
        <div className="customer-account-toolbar"><span>Recent requests</span><button type="button" className="customer-account-refresh" disabled={ticketsLoading} onClick={() => setTicketRefreshCount(count => count + 1)}><RefreshCw size={15} aria-hidden="true" /> {ticketsLoading ? "Refreshing…" : "Refresh requests"}</button></div>
        {ticketsError && <div className="form-message error" role="alert">{ticketsError}<button type="button" className="text-button" disabled={ticketsLoading} onClick={() => setTicketRefreshCount(count => count + 1)}>Try again</button></div>}
        {ticketsLoading ? <div className="customer-account-loading" role="status">Loading your support requests…</div> : tickets.length ? <div className="customer-ticket-list">{tickets.map(ticket => <Link className="customer-ticket-link" key={ticket.id} to={`/support?ticket=${encodeURIComponent(ticket.ticket_number)}`}><span className="customer-ticket-copy"><small>{ticket.ticket_number}</small><strong>{ticket.subject}</strong><span>Updated <time dateTime={ticket.updated_at || ticket.created_at}>{new Date(ticket.updated_at || ticket.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></span></span><span className={`customer-ticket-status ${ticket.status}`}>{ticketStatuses[ticket.status] || ticket.status}</span><ArrowRight size={17} aria-hidden="true" /></Link>)}</div> : !ticketsError && <div className="customer-account-empty"><Headphones aria-hidden="true" /><h3>No support requests yet</h3><p>Start a request for help with an order, product, or your account.</p></div>}
        <Link className="customer-inline-link customer-all-conversations" to="/support">View all conversations <ArrowRight size={16} aria-hidden="true" /></Link>
      </>}
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
