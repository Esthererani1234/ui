import { useEffect, useMemo, useState } from "react";
import { Boxes, DollarSign, ImagePlus, LayoutDashboard, LockKeyhole, MessagesSquare, PackageCheck, Pencil, Plus, ShieldCheck, ShoppingBag, Smartphone, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel, spotAdjustmentLabel } from "../lib/pricing";

const blankProduct = { name: "", slug: "", sku: "", short_description: "", description: "", metal: "gold", category: "coin", metal_weight_oz: 1, price_mode: "dynamic", fixed_price: "", premium_fixed: 0, premium_percent: 0, inventory_count: 0, low_stock_threshold: 3, is_active: false, is_featured: false, badge: "", image_url: "", sort_order: 100 };
const statuses = ["pending_review", "awaiting_payment", "payment_received", "processing", "shipped", "completed", "cancelled"];
const orderFields = "id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number, created_at, updated_at, order_items(*)";
const imagePath = (url) => {
  const marker = "/storage/v1/object/public/product-images/";
  return url?.includes(marker) ? decodeURIComponent(url.split(marker)[1]) : null;
};

export default function AdminPage() {
  const [tab, setTab] = useState("overview");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [temporaryImagePath, setTemporaryImagePath] = useState("");
  const [aal, setAal] = useState(null);

  const load = async () => {
    const [{ data: productData, error: productError }, { data: orderData, error: orderError }, { data: ticketData, error: ticketError }] = await Promise.all([
      supabase.from("products").select("*").order("sort_order"),
      supabase.from("orders").select(orderFields).order("created_at", { ascending: false }).limit(100),
      supabase.from("support_tickets").select("id, ticket_number, user_id, category, order_number, subject, message, status, admin_response, created_at, updated_at").order("created_at", { ascending: false }).limit(100),
    ]);
    setProducts(productData || []); setOrders(orderData || []); setTickets(ticketData || []);
    if (productError || orderError || ticketError) setMessage("Some admin data could not be loaded. Refresh and try again.");
  };
  useEffect(() => {
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data?.currentLevel || "aal1"));
  }, []);
  useEffect(() => { if (aal === "aal2") load(); }, [aal]);
  useEffect(() => {
    if (aal !== "aal2") return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.assign("/login");
      }, 15 * 60 * 1000);
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [aal]);
  useEffect(() => {
    if (editor || !temporaryImagePath) return;
    supabase.storage.from("product-images").remove([temporaryImagePath]);
    setTemporaryImagePath("");
  }, [editor, temporaryImagePath]);

  const metrics = useMemo(() => ({
    revenue: orders.filter((o) => !["cancelled", "pending_review"].includes(o.status)).reduce((sum, o) => sum + Number(o.total), 0),
    open: orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length,
    lowStock: products.filter((p) => p.inventory_count <= p.low_stock_threshold).length,
  }), [orders, products]);

  const saveProduct = async (event) => {
    event.preventDefault(); setMessage("");
    const adjustment = Number(editor.premium_percent);
    if (!Number.isFinite(adjustment) || adjustment < -99 || adjustment > 99) return setMessage("Spot adjustment must be between -99% and +99%.");
    const originalImageUrl = editor._original_image_url;
    const payload = { ...editor, price_mode: "dynamic", fixed_price: null, premium_fixed: 0, premium_percent: adjustment };
    delete payload.id; delete payload.created_at; delete payload.updated_at; delete payload._original_image_url; delete payload._uploaded_image_path;
    for (const key of ["metal_weight_oz", "fixed_price", "premium_fixed", "premium_percent", "inventory_count", "low_stock_threshold", "sort_order"]) payload[key] = payload[key] === "" ? null : Number(payload[key]);
    const result = editor.id ? await supabase.from("products").update(payload).eq("id", editor.id) : await supabase.from("products").insert(payload);
    if (result.error) return setMessage(result.error.message);
    const oldPath = originalImageUrl !== payload.image_url ? imagePath(originalImageUrl) : null;
    if (oldPath) await supabase.storage.from("product-images").remove([oldPath]);
    setTemporaryImagePath("");
    setEditor(null); await load();
  };

  const updateOrder = async (id, status) => {
    const updates = { status };
    if (status === "payment_received") updates.payment_status = "paid";
    const { error } = await supabase.from("orders").update(updates).eq("id", id);
    if (error) setMessage(error.message); else load();
  };

  const updateTicket = async (id, updates) => {
    setMessage("");
    const { error } = await supabase.from("support_tickets").update(updates).eq("id", id);
    if (error) setMessage("The support ticket could not be updated."); else await load();
  };

  const uploadProductImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setMessage("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setMessage("The image must be 5 MB or smaller.");
    setUploading(true); setMessage("");
    const previousTemporaryPath = editor._uploaded_image_path;
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { cacheControl: "31536000", upsert: false });
    if (error) {
      setUploading(false); setMessage(error.message); return;
    }
    if (previousTemporaryPath) await supabase.storage.from("product-images").remove([previousTemporaryPath]);
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    setEditor((current) => ({ ...current, image_url: data.publicUrl, _uploaded_image_path: path }));
    setTemporaryImagePath(path);
    setUploading(false);
  };

  const removeProductImage = async () => {
    if (editor._uploaded_image_path) await supabase.storage.from("product-images").remove([editor._uploaded_image_path]);
    setTemporaryImagePath("");
    setEditor((current) => ({ ...current, image_url: "", _uploaded_image_path: null }));
  };

  if (aal === null) return <div className="page-loader">Checking administrator security…</div>;
  if (aal !== "aal2") return <AdminMfaGate onVerified={() => setAal("aal2")} />;

  return (
    <section className="admin-shell"><aside className="admin-sidebar"><div className="admin-wordmark"><span>G</span><b>GOTS Admin</b></div><nav><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard /> Overview</button><button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}><Boxes /> Products</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><ShoppingBag /> Orders</button><button className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}><MessagesSquare /> Support</button></nav><a href="/">← Return to storefront</a></aside>
      <div className="admin-main"><header><div><span>GOLDONTHESPOT OPERATIONS</span><h1>{tab === "overview" ? "Dashboard" : tab === "products" ? "Products & pricing" : tab === "orders" ? "Order management" : "Customer support"}</h1></div>{tab === "products" && <button className="button button-gold" onClick={() => setEditor({ ...blankProduct, _original_image_url: "" })}><Plus size={17} /> Add product</button>}</header>{message && <div className="form-message error">{message}</div>}
        {tab === "overview" && <><div className="metric-grid"><article><DollarSign /><span><small>ORDER VALUE</small><b>{money(metrics.revenue)}</b><em>non-cancelled reviewed orders</em></span></article><article><PackageCheck /><span><small>OPEN ORDERS</small><b>{metrics.open}</b><em>requiring fulfillment activity</em></span></article><article><Boxes /><span><small>LOW STOCK</small><b>{metrics.lowStock}</b><em>at or below alert threshold</em></span></article><article><ShoppingBag /><span><small>TOTAL ORDERS</small><b>{orders.length}</b><em>latest 100 loaded</em></span></article></div><div className="admin-panel"><div className="panel-title"><h2>Recent orders</h2><button className="text-button" onClick={() => setTab("orders")}>View all</button></div><OrderTable orders={orders.slice(0, 8)} onUpdate={updateOrder} /></div></>}
        {tab === "products" && <div className="admin-panel"><div className="panel-title"><div><h2>Catalog</h2><p>Every product price follows the selected metal's live spot price.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Live pricing rule</th><th>Inventory</th><th>Status</th><th></th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><b>{product.name}</b><small>{product.sku} • {product.metal_weight_oz} oz pure {product.metal}</small></td><td><b>{spotAdjustmentLabel(product.premium_percent)}</b></td><td><b className={product.inventory_count <= product.low_stock_threshold ? "danger-text" : ""}>{product.inventory_count}</b></td><td><span className={product.is_active ? "status-pill completed" : "status-pill cancelled"}>{product.is_active ? "Live" : "Draft"}</span></td><td><button className="icon-button" onClick={() => setEditor({ ...product, _original_image_url: product.image_url || "" })}><Pencil size={17} /></button></td></tr>)}</tbody></table></div></div>}
        {tab === "orders" && <div className="admin-panel"><div className="panel-title"><div><h2>All orders</h2><p>Review payment and fulfillment before changing status.</p></div></div><OrderTable orders={orders} onUpdate={updateOrder} detailed /></div>}
        {tab === "support" && <div className="admin-panel"><div className="panel-title"><div><h2>Support tickets</h2><p>Only the verified administrator and the ticket owner can read these messages.</p></div><span className="status-pill">{tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length} open</span></div>{tickets.length ? <div className="admin-ticket-list">{tickets.map((ticket) => <AdminTicket key={ticket.id} ticket={ticket} onSave={updateTicket} />)}</div> : <div className="empty-state compact"><h3>No support tickets</h3><p>Customer requests will appear here.</p></div>}</div>}
      </div>
      {editor && <div className="modal-backdrop" role="presentation"><form className="product-editor" onSubmit={saveProduct} role="dialog" aria-modal="true" aria-label={editor.id ? "Edit product" : "Add product"}><header><div><small>CATALOG EDITOR</small><h2>{editor.id ? "Edit product" : "Add product"}</h2></div><button type="button" className="icon-button" onClick={() => setEditor(null)}><X /></button></header><div className="editor-scroll"><div className="product-image-editor"><div className="image-preview">{editor.image_url ? <img src={editor.image_url} alt="Product preview" /> : <span><ImagePlus /><b>No product picture yet</b><small>Upload JPG, PNG, or WebP up to 5 MB</small></span>}</div><div><label className="button button-dark upload-button"><ImagePlus size={17} /> {uploading ? "Uploading…" : "Upload picture"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={uploadProductImage} disabled={uploading} /></label>{editor.image_url && <button type="button" className="button button-outline" onClick={removeProductImage}><Trash2 size={16} /> Remove picture</button>}<p>The picture will appear on the shop page and product page.</p></div></div><div className="form-row"><label>Product name<input required value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label><label>SKU<input required value={editor.sku} onChange={(e) => setEditor({ ...editor, sku: e.target.value.toUpperCase() })} /></label></div><label>URL slug<input required value={editor.slug} onChange={(e) => setEditor({ ...editor, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") })} /></label><label>Short description<input value={editor.short_description || ""} onChange={(e) => setEditor({ ...editor, short_description: e.target.value })} /></label><label>Full description<textarea rows="4" value={editor.description || ""} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label><div className="form-row three"><label>Metal<select value={editor.metal} onChange={(e) => setEditor({ ...editor, metal: e.target.value })}><option value="gold">Gold</option><option value="silver">Silver</option><option value="platinum">Platinum</option><option value="palladium">Palladium</option></select></label><label>Type<select value={editor.category} onChange={(e) => setEditor({ ...editor, category: e.target.value })}><option>coin</option><option>bar</option><option>round</option></select></label><label>Pure metal weight (troy oz)<input type="number" step="0.000001" min="0.000001" required value={editor.metal_weight_oz} onChange={(e) => setEditor({ ...editor, metal_weight_oz: e.target.value })} /></label></div><div className="editor-section spot-pricing-section"><h3>Live spot pricing</h3><p>Price = live {editor.metal} spot × pure weight × spot adjustment.</p><label>Percentage above or below spot<input type="number" step="0.01" min="-99" max="99" required value={editor.premium_percent} onChange={(e) => setEditor({ ...editor, premium_percent: e.target.value })} /><small className="field-help">Enter -2 for 2% below spot, 0 for spot, or 3.5 for 3.5% above spot. Current rule: {spotAdjustmentLabel(editor.premium_percent)}</small></label></div><div className="editor-section"><h3>Inventory & display</h3><div className="form-row three"><label>Available units<input type="number" min="0" value={editor.inventory_count} onChange={(e) => setEditor({ ...editor, inventory_count: e.target.value })} /></label><label>Low-stock alert<input type="number" min="0" value={editor.low_stock_threshold} onChange={(e) => setEditor({ ...editor, low_stock_threshold: e.target.value })} /></label><label>Display position<input type="number" value={editor.sort_order} onChange={(e) => setEditor({ ...editor, sort_order: e.target.value })} /><small className="field-help">Lower numbers appear earlier in the shop. This is not a price.</small></label></div><label>Badge<input placeholder="BEST SELLER" value={editor.badge || ""} onChange={(e) => setEditor({ ...editor, badge: e.target.value })} /></label><div className="toggle-row"><label><input type="checkbox" checked={editor.is_active} onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })} /> Product is live</label><label><input type="checkbox" checked={editor.is_featured} onChange={(e) => setEditor({ ...editor, is_featured: e.target.checked })} /> Feature on homepage</label></div></div></div><footer><button type="button" className="button button-outline" onClick={() => setEditor(null)}>Cancel</button><button className="button button-gold" disabled={uploading}>Save product</button></footer></form></div>}
    </section>
  );
}

function AdminMfaGate({ onVerified }) {
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) { if (active) { setMessage(listError.message); setLoading(false); } return; }
      const verified = factors?.totp?.find((factor) => factor.status === "verified");
      if (verified) { if (active) { setFactorId(verified.id); setLoading(false); } return; }
      const pending = factors?.totp?.filter((factor) => factor.status !== "verified") || [];
      await Promise.all(pending.map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })));
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "GoldOnTheSpot Admin" });
      if (!active) return;
      if (error) setMessage(error.message);
      else { setEnrollment(data); setFactorId(data.id); }
      setLoading(false);
    };
    prepare();
    return () => { active = false; };
  }, []);

  const verify = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return setMessage("Enter the six-digit code from your authenticator app.");
    setVerifying(true); setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) { setMessage(error.message); setVerifying(false); return; }
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setVerifying(false);
    if (data?.currentLevel === "aal2") onVerified();
    else setMessage("Two-factor verification did not complete. Please try again.");
  };

  return <section className="mfa-shell"><div className="mfa-card"><ShieldCheck className="mfa-shield" /><span className="eyebrow dark">ADMIN PROTECTION</span><h1>Two-factor verification required</h1><p>{enrollment ? "Before this administrator account can change products or orders, connect an authenticator app." : "Enter the current code from your authenticator app to unlock the dashboard."}</p>{loading ? <div className="catalog-loading">Preparing secure verification…</div> : <>{enrollment && <div className="mfa-enrollment"><img src={enrollment.totp.qr_code} alt="Authenticator QR code" /><div><b>1. Scan this QR code</b><span>Use Google Authenticator, Microsoft Authenticator, Authy, or another TOTP app.</span><b>2. Save this backup setup key</b><code>{enrollment.totp.secret}</code></div></div>}<form onSubmit={verify}><label><Smartphone /> Six-digit authenticator code<input inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" /></label>{message && <div className="form-message error">{message}</div>}<button className="button button-gold full large" disabled={verifying || !factorId}><LockKeyhole size={17} /> {verifying ? "Verifying…" : "Unlock admin dashboard"}</button></form></>}</div></section>;
}

function AdminTicket({ ticket, onSave }) {
  const [response, setResponse] = useState(ticket.admin_response || "");
  const [status, setStatus] = useState(ticket.status);
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); await onSave(ticket.id, { status, admin_response: response.trim() || null }); setSaving(false); };
  return <article className="admin-ticket"><header><div><small>{ticket.ticket_number} • {ticket.category}</small><h3>{ticket.subject}</h3><span>{new Date(ticket.created_at).toLocaleString()}</span></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></header>{ticket.order_number && <b>Order: {ticket.order_number}</b>}<p>{ticket.message}</p><label>Response to customer<textarea rows="4" maxLength="5000" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Write a clear response. Do not request passwords or payment credentials." /></label><button className="button button-dark" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save response"}</button></article>;
}

function OrderTable({ orders, onUpdate, detailed = false }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th>{detailed && <th>Payment</th>}<th>Status</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><b>{order.order_number}</b><small>{new Date(order.created_at).toLocaleString()}</small></td><td><b>{order.first_name} {order.last_name}</b><small>{order.email}</small></td><td><b>{money(order.total)}</b><small>{order.order_items?.length || 0} lines</small></td>{detailed && <td><b>{orderStatusLabel(order.payment_method)}</b><small>{order.payment_status}</small></td>}<td><select className={`status-select ${order.status}`} value={order.status} onChange={(e) => onUpdate(order.id, e.target.value)}>{statuses.map((status) => <option value={status} key={status}>{orderStatusLabel(status)}</option>)}</select></td></tr>)}</tbody></table>{!orders.length && <div className="empty-state compact"><h3>No orders yet</h3></div>}</div>;
}
