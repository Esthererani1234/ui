import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  BarChart3,
  CheckCircle2,
  Clock3,
  KeyRound,
  MailCheck,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserCheck,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { money, orderStatusLabel } from "../../lib/pricing";

const invokeAdmin = async (body) => {
  const { data, error } = await supabase.functions.invoke("admin-operations", {
    body,
  });
  if (error || data?.error)
    throw new Error(data?.error || error?.message || "Admin operation failed");
  return data;
};

const dateTime = (value) =>
  value ? new Date(value).toLocaleString() : "Never";
const isSuspended = (customer) =>
  Boolean(customer?.banned_until && new Date(customer.banned_until) > new Date());
const riskClass = (value) => `risk-pill ${value || "normal"}`;

export function CustomerAdminPanel() {
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const data = await invokeAdmin({ action: "list_customers" });
      setCustomers(data.customers || []);
      if (selected) {
        const refreshed = (data.customers || []).find(
          (customer) => customer.id === selected.id,
        );
        setSelected(refreshed || null);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const risk = customer.risk?.status || "normal";
      if (status === "suspended" && !isSuspended(customer)) return false;
      if (status === "sms" && !customer.has_phone_mfa) return false;
      if (
        status === "flagged" &&
        !["watch", "review", "blocked"].includes(risk)
      )
        return false;
      if (["watch", "review", "blocked"].includes(status) && risk !== status)
        return false;
      return normalized
        ? `${customer.email} ${customer.phone} ${customer.profile?.first_name || ""} ${customer.profile?.last_name || ""} ${customer.id}`
            .toLowerCase()
            .includes(normalized)
        : true;
    });
  }, [customers, query, status]);

  const metrics = useMemo(
    () => ({
      total: customers.length,
      sms: customers.filter((customer) => customer.has_phone_mfa).length,
      review: customers.filter((customer) =>
        ["watch", "review", "blocked"].includes(customer.risk?.status),
      ).length,
      suspended: customers.filter(isSuspended).length,
    }),
    [customers],
  );

  return (
    <div className="enterprise-admin-stack">
      <div className="enterprise-metrics">
        <button type="button" onClick={() => setStatus("all")}><b>{metrics.total}</b><span>Customer accounts</span></button>
        <button type="button" onClick={() => setStatus("sms")}><b>{metrics.sms}</b><span>SMS protected</span></button>
        <button type="button" onClick={() => setStatus("flagged")}><b>{metrics.review}</b><span>Flagged for review</span></button>
        <button type="button" onClick={() => setStatus("suspended")}><b>{metrics.suspended}</b><span>Suspended</span></button>
      </div>
      <section className="admin-panel">
        <div className="panel-title enterprise-panel-title">
          <div>
            <h2>Customer operations</h2>
            <p>Identity, security, lifetime orders, account access, and internal risk controls.</p>
          </div>
          <button className="button button-outline" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        <div className="enterprise-toolbar">
          <label><Search /><input placeholder="Search customer, phone, email, or ID…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All customers</option>
            <option value="sms">SMS protected</option>
            <option value="flagged">Any flagged risk</option>
            <option value="watch">Watch list</option>
            <option value="review">Manual review</option>
            <option value="blocked">Blocked</option>
            <option value="suspended">Suspended login</option>
          </select>
        </div>
        {message && <div className="form-message error">{message}</div>}
        {loading ? (
          <div className="catalog-loading">Loading protected customer records…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table enterprise-customer-table">
              <thead><tr><th>Customer</th><th>Security</th><th>Orders</th><th>Risk</th><th>Access</th><th></th></tr></thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr key={customer.id}>
                    <td><b>{customer.profile?.first_name || ""} {customer.profile?.last_name || ""}</b><small>{customer.email}</small><small>{customer.phone || "No phone saved"}</small></td>
                    <td><span className={`security-state ${customer.has_phone_mfa ? "verified" : "pending"}`}>{customer.has_phone_mfa ? <ShieldCheck /> : <AlertTriangle />}{customer.has_phone_mfa ? "SMS MFA" : "No SMS MFA"}</span><small>Email {customer.email_confirmed_at ? "confirmed" : "pending"}</small></td>
                    <td><b>{customer.order_count} orders</b><small>{money(customer.lifetime_value)} lifetime value</small></td>
                    <td><span className={riskClass(customer.risk?.status)}>{customer.risk?.status || "normal"}</span><small>Score {customer.risk?.risk_score || 0}/100</small></td>
                    <td><span className={`access-pill ${isSuspended(customer) ? "suspended" : "active"}`}>{isSuspended(customer) ? "Suspended" : "Active"}</span><small>Last sign-in {dateTime(customer.last_sign_in_at)}</small></td>
                    <td><button className="button button-outline" onClick={() => setSelected(customer)}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <div className="empty-state compact"><h3>No matching customers</h3></div>}
          </div>
        )}
      </section>
      {selected && (
        <CustomerDrawer
          customer={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function CustomerDrawer({ customer, onClose, onChanged }) {
  const existingRisk = customer.risk || {};
  const [form, setForm] = useState({
    status: existingRisk.status || "normal",
    riskScore: existingRisk.risk_score || 0,
    tags: (existingRisk.tags || []).join(", "),
    manualReview: Boolean(existingRisk.manual_review_required),
    checkoutDisabled: Boolean(existingRisk.checkout_disabled),
    notes: existingRisk.internal_notes || "",
    reason: "",
  });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const run = async (name, body) => {
    setBusy(name);
    setMessage("");
    try {
      await invokeAdmin(body);
      setMessage("Change saved and added to the admin audit log.");
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="enterprise-drawer-backdrop" role="presentation">
      <aside className="enterprise-drawer" role="dialog" aria-modal="true" aria-label="Customer operations">
        <header><div><small>CUSTOMER OPERATIONS</small><h2>{customer.profile?.first_name || ""} {customer.profile?.last_name || ""}</h2><span>{customer.email}</span></div><button className="icon-button" onClick={onClose}><X /></button></header>
        <div className="enterprise-drawer-scroll">
          <section className="customer-security-overview">
            <div><span>Email</span><b>{customer.email_confirmed_at ? "Confirmed" : "Confirmation pending"}</b></div>
            <div><span>SMS factor</span><b>{customer.has_phone_mfa ? "Verified" : "Not enrolled"}</b></div>
            <div><span>Created</span><b>{dateTime(customer.created_at)}</b></div>
            <div><span>Last sign-in</span><b>{dateTime(customer.last_sign_in_at)}</b></div>
          </section>
          <section className="enterprise-detail-section">
            <h3>Customer profile</h3>
            <dl className="customer-detail-grid">
              <div><dt>Phone</dt><dd>{customer.phone || "Not saved"}</dd></div>
              <div><dt>Customer ID</dt><dd>{customer.id}</dd></div>
              <div><dt>Address</dt><dd>{[customer.profile?.address_line_1, customer.profile?.address_line_2, customer.profile?.city, customer.profile?.state, customer.profile?.postal_code].filter(Boolean).join(", ") || "Not saved"}</dd></div>
              <div><dt>Lifetime value</dt><dd>{money(customer.lifetime_value)}</dd></div>
            </dl>
          </section>
          <section className="enterprise-detail-section">
            <h3>Fraud and manual-review controls</h3>
            <div className="form-row">
              <label>Risk status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="normal">Normal</option><option value="watch">Watch</option><option value="review">Manual review</option><option value="blocked">Blocked</option></select></label>
              <label>Risk score<input type="number" min="0" max="100" value={form.riskScore} onChange={(event) => setForm({ ...form, riskScore: event.target.value })} /></label>
            </div>
            <label>Tags<input placeholder="high value, address change" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label>
            <label>Private admin notes<textarea rows="5" maxLength="5000" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <label className="enterprise-check"><input type="checkbox" checked={form.manualReview} onChange={(event) => setForm({ ...form, manualReview: event.target.checked })} /> Require manual review for new orders</label>
            <label className="enterprise-check"><input type="checkbox" checked={form.checkoutDisabled} onChange={(event) => setForm({ ...form, checkoutDisabled: event.target.checked })} /> Disable checkout for this customer</label>
          </section>
          <section className="enterprise-detail-section">
            <h3>Required reason</h3>
            <label>Reason for the audit log<textarea rows="3" maxLength="1000" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Why are you making this change?" /></label>
            <button className="button button-dark full" disabled={Boolean(busy)} onClick={() => run("risk", { action: "update_customer_risk", user_id: customer.id, status: form.status, risk_score: Number(form.riskScore), tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean), manual_review_required: form.manualReview, checkout_disabled: form.checkoutDisabled, internal_notes: form.notes, reason: form.reason })}><Save /> {busy === "risk" ? "Saving…" : "Save fraud controls"}</button>
          </section>
          <section className="enterprise-detail-section">
            <h3>Account actions</h3>
            <div className="enterprise-action-grid">
              <button className="button button-outline" disabled={Boolean(busy)} onClick={() => run("recovery", { action: "send_auth_email", email_type: "recovery", email: customer.email, reason: form.reason })}><KeyRound /> Send password reset</button>
              {!customer.email_confirmed_at && <button className="button button-outline" disabled={Boolean(busy)} onClick={() => run("confirmation", { action: "send_auth_email", email_type: "confirmation", email: customer.email, reason: form.reason })}><MailCheck /> Resend confirmation</button>}
              <button className={`button ${isSuspended(customer) ? "button-dark" : "button-danger"}`} disabled={Boolean(busy) || form.reason.trim().length < 3} onClick={() => run("access", { action: "set_customer_access", user_id: customer.id, suspended: !isSuspended(customer), reason: form.reason })}>{isSuspended(customer) ? <UserCheck /> : <Ban />}{isSuspended(customer) ? "Restore account access" : "Suspend account access"}</button>
            </div>
          </section>
          <section className="enterprise-detail-section">
            <h3>Recent orders</h3>
            <div className="customer-order-history">
              {(customer.orders || []).map((order) => <div key={order.id}><span><b>{order.order_number}</b><small>{dateTime(order.created_at)} • {orderStatusLabel(order.status)}</small></span><strong>{money(order.total)}</strong></div>)}
              {!customer.orders?.length && <p>No orders yet.</p>}
            </div>
          </section>
          {message && <div className="form-message">{message}</div>}
        </div>
      </aside>
    </div>
  );
}

export function RiskAdminPanel() {
  const [reviews, setReviews] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("order_risk_reviews")
      .select("*, orders(order_number, total, status, created_at, first_name, last_name, email)")
      .order("risk_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setMessage(error.message);
    setReviews(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const filtered = reviews.filter((review) => filter === "all" || review.decision === filter);

  const decide = async (decision) => {
    if (!selected || reason.trim().length < 3) return setMessage("Enter a reason for the review decision.");
    try {
      await invokeAdmin({ action: "review_order", order_id: selected.order_id, decision, reason, admin_notes: notes });
      setMessage("Risk decision saved to the audit log.");
      setSelected(null); setReason(""); setNotes(""); await load();
    } catch (error) { setMessage(error.message); }
  };

  return <div className="enterprise-admin-stack">
    <section className="admin-panel">
      <div className="panel-title enterprise-panel-title"><div><h2>Order risk center</h2><p>Automatic signals prioritize orders for human review. Scores assist decisions; they do not replace judgment.</p></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All decisions</option></select></div>
      {message && <div className="form-message">{message}</div>}
      {loading ? <div className="catalog-loading">Calculating risk queue…</div> : <div className="risk-review-grid">{filtered.map((review) => <article key={review.order_id} className={`risk-review-card ${review.risk_level}`}><header><span className={`risk-score ${review.risk_level}`}>{review.risk_score}</span><div><small>{review.orders?.order_number}</small><h3>{review.orders?.first_name} {review.orders?.last_name}</h3><span>{review.orders?.email}</span></div><b>{money(review.orders?.total)}</b></header><div className="risk-signals">{(review.signals || []).map((signal, index) => <span key={`${signal.code}-${index}`}><AlertTriangle /> {signal.label}</span>)}</div><footer><span className={riskClass(review.decision)}>{review.decision}</span><button className="button button-outline" onClick={() => { setSelected(review); setNotes(review.admin_notes || ""); }}>Review</button></footer></article>)}</div>}
      {!loading && !filtered.length && <div className="empty-state compact"><CheckCircle2 /><h3>No orders in this queue</h3></div>}
    </section>
    {selected && <div className="modal-backdrop"><div className="risk-decision-modal" role="dialog" aria-modal="true"><header><div><small>ORDER RISK REVIEW</small><h2>{selected.orders?.order_number}</h2></div><button className="icon-button" onClick={() => setSelected(null)}><X /></button></header><div><div className="risk-decision-score"><ShieldAlert /><span><b>{selected.risk_score}/100</b><small>{selected.risk_level} risk</small></span></div><label>Private review notes<textarea rows="5" maxLength="5000" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label>Required decision reason<textarea rows="3" maxLength="1000" value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><footer><button className="button button-outline" onClick={() => decide("rejected")}>Reject</button><button className="button button-dark" onClick={() => decide("pending")}>Keep pending</button><button className="button button-gold" onClick={() => decide("approved")}>Approve review</button></footer></div></div>}
  </div>;
}

export function SecurityAdminPanel() {
  const [form, setForm] = useState({ smsProvider: "twilio", smsSender: "", smsProviderReady: false, smsRequired: false, brandedEmailReady: false, reason: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await supabase.from("app_settings").select("key, value").in("key", ["sms_provider_name", "sms_sender", "sms_provider_ready", "customer_sms_mfa_required", "branded_email_ready"]);
    const settings = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
    setForm((current) => ({ ...current, smsProvider: settings.sms_provider_name || "twilio", smsSender: settings.sms_sender || "", smsProviderReady: Boolean(settings.sms_provider_ready), smsRequired: Boolean(settings.customer_sms_mfa_required), brandedEmailReady: Boolean(settings.branded_email_ready) }));
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      await invokeAdmin({ action: "update_security_settings", sms_provider_name: form.smsProvider, sms_sender: form.smsSender, sms_provider_ready: form.smsProviderReady, customer_sms_mfa_required: form.smsRequired, branded_email_ready: form.brandedEmailReady, reason: form.reason });
      setMessage("Security policy saved and audited."); await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return <div className="enterprise-admin-stack">
    <div className="security-control-grid">
      <article><ShieldCheck /><span><small>ADMIN DATABASE ACCESS</small><h2>Authenticator MFA enforced</h2><p>Admin RLS now requires an AAL2 session. The dashboard alone is no longer the security boundary.</p><b className="control-ready"><CheckCircle2 /> Active</b></span></article>
      <article><MessageSquareText /><span><small>CUSTOMER IDENTITY</small><h2>SMS verification</h2><p>Customers can be required to verify a text code on every fresh sign-in before account or checkout access.</p><b className={form.smsRequired ? "control-ready" : "control-pending"}>{form.smsRequired ? <CheckCircle2 /> : <Clock3 />}{form.smsRequired ? "Required" : "Waiting for provider"}</b></span></article>
      <article><MailCheck /><span><small>AUTH EMAIL DELIVERY</small><h2>GoldOnTheSpot branded mail</h2><p>Custom HTML templates are ready. Custom SMTP must be connected so messages come from your domain.</p><b className={form.brandedEmailReady ? "control-ready" : "control-pending"}>{form.brandedEmailReady ? <CheckCircle2 /> : <Clock3 />}{form.brandedEmailReady ? "Configured" : "SMTP needed"}</b></span></article>
    </div>
    <section className="admin-panel security-activation-panel"><div className="panel-title"><div><h2>Authentication rollout controls</h2><p>These switches prevent an unfinished provider setup from locking customers out.</p></div></div>
      <div className="form-row">
        <label>SMS provider<select value={form.smsProvider} onChange={(event) => setForm({ ...form, smsProvider: event.target.value })}><option value="twilio">Twilio</option><option value="vonage">Vonage</option><option value="messagebird">MessageBird</option></select></label>
        <label>Sender phone number<input type="tel" maxLength="30" placeholder="+1 212 555 0100" value={form.smsSender} onChange={(event) => setForm({ ...form, smsSender: event.target.value })} /></label>
      </div>
      <div className="security-warning"><b>Provider credentials stay off this web page</b><span>You can choose and manage the rollout here, but API secrets need a one-time encrypted server connection. They are never returned to the browser or displayed to staff.</span></div>
      <label className="security-rollout-check"><input type="checkbox" checked={form.smsProviderReady} onChange={(event) => setForm({ ...form, smsProviderReady: event.target.checked, smsRequired: event.target.checked ? form.smsRequired : false })} /><span><b>SMS provider is connected and tested</b><small>Confirm only after Twilio, Vonage, or MessageBird successfully delivers a test code.</small></span></label>
      <label className="security-rollout-check"><input type="checkbox" disabled={!form.smsProviderReady} checked={form.smsRequired} onChange={(event) => setForm({ ...form, smsRequired: event.target.checked })} /><span><b>Require SMS MFA for every customer</b><small>Existing customers will enroll their phone at the next sign-in.</small></span></label>
      <label className="security-rollout-check"><input type="checkbox" checked={form.brandedEmailReady} onChange={(event) => setForm({ ...form, brandedEmailReady: event.target.checked })} /><span><b>Custom GoldOnTheSpot SMTP and templates are active</b><small>Confirmation and recovery emails should show your name and domain—not Supabase.</small></span></label>
      <label>Required rollout reason<textarea rows="3" maxLength="1000" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Example: Twilio delivery tested on July 16" /></label>
      {message && <div className="form-message">{message}</div>}
      <button className="button button-dark" onClick={save} disabled={busy}><Save /> {busy ? "Saving…" : "Save security policy"}</button>
    </section>
  </div>;
}

export function SalesAdminPanel() {
  const [days, setDays] = useState("30");
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const data = await invokeAdmin({ action: "sales_report", days: Number(days) });
      setReport(data.report);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [days]);

  return <div className="enterprise-admin-stack">
    <section className="admin-panel">
      <div className="panel-title enterprise-panel-title"><div><h2>Sales performance</h2><p>Booked, non-cancelled orders. Pending payments remain visible in the status breakdown.</p></div><select value={days} onChange={(event) => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="0">All time</option></select></div>
      {message && <div className="form-message error">{message}</div>}
      {loading ? <div className="catalog-loading">Building secure sales report…</div> : <>
        <div className="enterprise-metrics sales-metrics">
          <div><b>{money(report?.gross_sales || 0)}</b><span>Booked order value</span></div>
          <div><b>{report?.order_count || 0}</b><span>Orders</span></div>
          <div><b>{money(report?.average_order || 0)}</b><span>Average order</span></div>
          <div><b>{report?.units || 0}</b><span>Units ordered</span></div>
        </div>
        <div className="sales-report-grid">
          <section><h3>Top products</h3>{(report?.top_products || []).map((item) => <div className="sales-list-row" key={item.name}><span><b>{item.name}</b><small>{item.units} units</small></span><strong>{money(item.sales)}</strong></div>)}{!report?.top_products?.length && <p>No sales in this period.</p>}</section>
          <section><h3>Sales by metal</h3>{(report?.metals || []).map((item) => <div className="sales-list-row" key={item.metal}><span><b>{item.metal}</b><small>{item.units} units</small></span><strong>{money(item.sales)}</strong></div>)}{!report?.metals?.length && <p>No metal sales in this period.</p>}</section>
          <section><h3>Order status</h3>{Object.entries(report?.statuses || {}).map(([status, count]) => <div className="sales-list-row" key={status}><span><b>{orderStatusLabel(status)}</b></span><strong>{count}</strong></div>)}</section>
          <section><h3>Payment method</h3>{Object.entries(report?.payments || {}).map(([method, count]) => <div className="sales-list-row" key={method}><span><b>{orderStatusLabel(method)}</b></span><strong>{count}</strong></div>)}</section>
        </div>
      </>}
    </section>
  </div>;
}

const storeDefaults = {
  shipping_flat: 35,
  free_shipping_threshold: 5000,
  card_surcharge_percent: 4,
  price_lock_minutes: 5,
  store_announcement: "",
  accepting_orders: true,
};

export function StoreAdminPanel() {
  const [form, setForm] = useState({ ...storeDefaults, reason: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("app_settings").select("key, value").in("key", Object.keys(storeDefaults));
    if (error) return setMessage(error.message);
    const values = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
    setForm((current) => ({ ...current, ...storeDefaults, ...values, reason: "" }));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      await invokeAdmin({ action: "update_store_settings", settings: {
        shipping_flat: Number(form.shipping_flat),
        free_shipping_threshold: Number(form.free_shipping_threshold),
        card_surcharge_percent: Number(form.card_surcharge_percent),
        price_lock_minutes: Number(form.price_lock_minutes),
        store_announcement: form.store_announcement,
        accepting_orders: Boolean(form.accepting_orders),
      }, reason: form.reason });
      setMessage("Store settings saved, published, and added to the audit log.");
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const numberField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return <div className="enterprise-admin-stack">
    <div className="store-state-card"><Store /><span><small>STOREFRONT STATUS</small><h2>{form.accepting_orders ? "Accepting customer orders" : "Checkout paused"}</h2><p>Catalog browsing stays available if checkout is paused.</p></span><label className="store-switch"><input type="checkbox" checked={Boolean(form.accepting_orders)} onChange={(event) => setForm({ ...form, accepting_orders: event.target.checked })} /><span>{form.accepting_orders ? "Open" : "Paused"}</span></label></div>
    <section className="admin-panel store-settings-panel">
      <div className="panel-title"><div><h2>Website and checkout settings</h2><p>Routine store controls are managed here; no database dashboard is needed.</p></div><BarChart3 /></div>
      <div className="form-row">
        <label>Insured shipping fee ($)<input type="number" min="0" max="10000" step="0.01" value={form.shipping_flat} onChange={(event) => numberField("shipping_flat", event.target.value)} /></label>
        <label>Free shipping threshold ($)<input type="number" min="0" max="1000000" step="0.01" value={form.free_shipping_threshold} onChange={(event) => numberField("free_shipping_threshold", event.target.value)} /></label>
      </div>
      <div className="form-row">
        <label>Card surcharge (%)<input type="number" min="0" max="10" step="0.1" value={form.card_surcharge_percent} onChange={(event) => numberField("card_surcharge_percent", event.target.value)} /></label>
        <label>Price lock (minutes)<input type="number" min="1" max="30" step="1" value={form.price_lock_minutes} onChange={(event) => numberField("price_lock_minutes", event.target.value)} /></label>
      </div>
      <label>Store announcement<input maxLength="160" placeholder="Example: Free insured shipping on orders over $5,000" value={form.store_announcement || ""} onChange={(event) => setForm({ ...form, store_announcement: event.target.value })} /><small className="field-help">Leave blank to hide the announcement bar. Maximum 160 characters.</small></label>
      <label>Required change reason<textarea rows="3" maxLength="1000" placeholder="Why are these settings changing?" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
      {message && <div className="form-message">{message}</div>}
      <button className="button button-dark" onClick={save} disabled={busy}><Save /> {busy ? "Publishing…" : "Save and publish settings"}</button>
    </section>
  </div>;
}

export function AuditAdminPanel() {
  const [logs, setLogs] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(500);
    setLogs(data || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const filtered = logs.filter((log) => `${log.action} ${log.target_type} ${log.target_id || ""} ${log.reason || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="admin-panel"><div className="panel-title enterprise-panel-title"><div><h2>Immutable admin activity</h2><p>Sensitive customer, order, fraud, and security-policy actions are recorded here.</p></div><button className="button button-outline" onClick={load}><RefreshCw /> Refresh</button></div><div className="enterprise-toolbar"><label><Search /><input placeholder="Search actions, targets, or reasons…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>{loading ? <div className="catalog-loading">Loading audit history…</div> : <div className="audit-timeline">{filtered.map((log) => <article key={log.id}><span className="audit-icon"><ShieldCheck /></span><div><header><b>{log.action.replaceAll(".", " ")}</b><time>{dateTime(log.created_at)}</time></header><p>{log.target_type} {log.target_id && `• ${log.target_id}`}</p>{log.reason && <blockquote>{log.reason}</blockquote>}<small>Actor {log.actor_user_id || "system"}</small></div></article>)}</div>}</section>;
}
