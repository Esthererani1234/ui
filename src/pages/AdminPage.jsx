import { useEffect, useMemo, useState } from "react";
import { Boxes, DollarSign, LayoutDashboard, PackageCheck, Pencil, Plus, ShoppingBag, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel } from "../lib/pricing";

const blankProduct = { name: "", slug: "", sku: "", short_description: "", description: "", metal: "gold", category: "coin", metal_weight_oz: 1, price_mode: "dynamic", fixed_price: "", premium_fixed: 0, premium_percent: 0, inventory_count: 0, low_stock_threshold: 3, is_active: false, is_featured: false, badge: "", image_url: "", sort_order: 100 };
const statuses = ["pending_review", "awaiting_payment", "payment_received", "processing", "shipped", "completed", "cancelled"];

export default function AdminPage() {
  const [tab, setTab] = useState("overview");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    const [{ data: productData }, { data: orderData }] = await Promise.all([
      supabase.from("products").select("*").order("sort_order"),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(100),
    ]);
    setProducts(productData || []); setOrders(orderData || []);
  };
  useEffect(() => { load(); }, []);

  const metrics = useMemo(() => ({
    revenue: orders.filter((o) => !["cancelled", "pending_review"].includes(o.status)).reduce((sum, o) => sum + Number(o.total), 0),
    open: orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length,
    lowStock: products.filter((p) => p.inventory_count <= p.low_stock_threshold).length,
  }), [orders, products]);

  const saveProduct = async (event) => {
    event.preventDefault(); setMessage("");
    const payload = { ...editor };
    delete payload.id; delete payload.created_at; delete payload.updated_at;
    for (const key of ["metal_weight_oz", "fixed_price", "premium_fixed", "premium_percent", "inventory_count", "low_stock_threshold", "sort_order"]) payload[key] = payload[key] === "" ? null : Number(payload[key]);
    const result = editor.id ? await supabase.from("products").update(payload).eq("id", editor.id) : await supabase.from("products").insert(payload);
    if (result.error) return setMessage(result.error.message);
    setEditor(null); await load();
  };

  const updateOrder = async (id, status) => {
    const updates = { status };
    if (status === "payment_received") updates.payment_status = "paid";
    const { error } = await supabase.from("orders").update(updates).eq("id", id);
    if (error) setMessage(error.message); else load();
  };

  return (
    <section className="admin-shell"><aside className="admin-sidebar"><div className="admin-wordmark"><span>G</span><b>GOTS Admin</b></div><nav><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard /> Overview</button><button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}><Boxes /> Products</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><ShoppingBag /> Orders</button></nav><a href="/">← Return to storefront</a></aside>
      <div className="admin-main"><header><div><span>GOLDONTHESPOT OPERATIONS</span><h1>{tab === "overview" ? "Dashboard" : tab === "products" ? "Products & pricing" : "Order management"}</h1></div>{tab === "products" && <button className="button button-gold" onClick={() => setEditor({ ...blankProduct })}><Plus size={17} /> Add product</button>}</header>{message && <div className="form-message error">{message}</div>}
        {tab === "overview" && <><div className="metric-grid"><article><DollarSign /><span><small>ORDER VALUE</small><b>{money(metrics.revenue)}</b><em>non-cancelled reviewed orders</em></span></article><article><PackageCheck /><span><small>OPEN ORDERS</small><b>{metrics.open}</b><em>requiring fulfillment activity</em></span></article><article><Boxes /><span><small>LOW STOCK</small><b>{metrics.lowStock}</b><em>at or below alert threshold</em></span></article><article><ShoppingBag /><span><small>TOTAL ORDERS</small><b>{orders.length}</b><em>latest 100 loaded</em></span></article></div><div className="admin-panel"><div className="panel-title"><h2>Recent orders</h2><button className="text-button" onClick={() => setTab("orders")}>View all</button></div><OrderTable orders={orders.slice(0, 8)} onUpdate={updateOrder} /></div></>}
        {tab === "products" && <div className="admin-panel"><div className="panel-title"><div><h2>Catalog</h2><p>Premium changes immediately affect displayed live prices.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Pricing rule</th><th>Inventory</th><th>Status</th><th></th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><b>{product.name}</b><small>{product.sku} • {product.metal_weight_oz} oz {product.metal}</small></td><td><b>{product.price_mode === "dynamic" ? `Spot + ${money(product.premium_fixed)} + ${product.premium_percent}%` : product.price_mode}</b></td><td><b className={product.inventory_count <= product.low_stock_threshold ? "danger-text" : ""}>{product.inventory_count}</b></td><td><span className={product.is_active ? "status-pill completed" : "status-pill cancelled"}>{product.is_active ? "Live" : "Draft"}</span></td><td><button className="icon-button" onClick={() => setEditor({ ...product })}><Pencil size={17} /></button></td></tr>)}</tbody></table></div></div>}
        {tab === "orders" && <div className="admin-panel"><div className="panel-title"><div><h2>All orders</h2><p>Review payment and fulfillment before changing status.</p></div></div><OrderTable orders={orders} onUpdate={updateOrder} detailed /></div>}
      </div>
      {editor && <div className="modal-backdrop"><form className="product-editor" onSubmit={saveProduct}><header><div><small>CATALOG EDITOR</small><h2>{editor.id ? "Edit product" : "Add product"}</h2></div><button type="button" className="icon-button" onClick={() => setEditor(null)}><X /></button></header><div className="editor-scroll"><div className="form-row"><label>Product name<input required value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label><label>SKU<input required value={editor.sku} onChange={(e) => setEditor({ ...editor, sku: e.target.value.toUpperCase() })} /></label></div><label>URL slug<input required value={editor.slug} onChange={(e) => setEditor({ ...editor, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") })} /></label><label>Short description<input value={editor.short_description || ""} onChange={(e) => setEditor({ ...editor, short_description: e.target.value })} /></label><label>Full description<textarea rows="4" value={editor.description || ""} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label><div className="form-row three"><label>Metal<select value={editor.metal} onChange={(e) => setEditor({ ...editor, metal: e.target.value })}><option>gold</option><option>silver</option><option>platinum</option><option>palladium</option></select></label><label>Type<select value={editor.category} onChange={(e) => setEditor({ ...editor, category: e.target.value })}><option>coin</option><option>bar</option><option>round</option></select></label><label>Fine weight (oz)<input type="number" step="0.000001" min="0" required value={editor.metal_weight_oz} onChange={(e) => setEditor({ ...editor, metal_weight_oz: e.target.value })} /></label></div><div className="editor-section"><h3>Pricing</h3><div className="form-row three"><label>Mode<select value={editor.price_mode} onChange={(e) => setEditor({ ...editor, price_mode: e.target.value })}><option value="dynamic">Spot + premium</option><option value="fixed">Fixed price</option><option value="quote">Quote only</option></select></label><label>Fixed premium ($)<input type="number" step="0.01" value={editor.premium_fixed} onChange={(e) => setEditor({ ...editor, premium_fixed: e.target.value })} /></label><label>Premium (%)<input type="number" step="0.01" value={editor.premium_percent} onChange={(e) => setEditor({ ...editor, premium_percent: e.target.value })} /></label></div></div><div className="editor-section"><h3>Inventory & display</h3><div className="form-row three"><label>Available units<input type="number" min="0" value={editor.inventory_count} onChange={(e) => setEditor({ ...editor, inventory_count: e.target.value })} /></label><label>Low-stock alert<input type="number" min="0" value={editor.low_stock_threshold} onChange={(e) => setEditor({ ...editor, low_stock_threshold: e.target.value })} /></label><label>Sort order<input type="number" value={editor.sort_order} onChange={(e) => setEditor({ ...editor, sort_order: e.target.value })} /></label></div><div className="form-row"><label>Badge<input placeholder="BEST SELLER" value={editor.badge || ""} onChange={(e) => setEditor({ ...editor, badge: e.target.value })} /></label><label>Image URL<input type="url" value={editor.image_url || ""} onChange={(e) => setEditor({ ...editor, image_url: e.target.value })} /></label></div><div className="toggle-row"><label><input type="checkbox" checked={editor.is_active} onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })} /> Product is live</label><label><input type="checkbox" checked={editor.is_featured} onChange={(e) => setEditor({ ...editor, is_featured: e.target.checked })} /> Feature on homepage</label></div></div></div><footer><button type="button" className="button button-outline" onClick={() => setEditor(null)}>Cancel</button><button className="button button-gold">Save product</button></footer></form></div>}
    </section>
  );
}

function OrderTable({ orders, onUpdate, detailed = false }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th>{detailed && <th>Payment</th>}<th>Status</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><b>{order.order_number}</b><small>{new Date(order.created_at).toLocaleString()}</small></td><td><b>{order.first_name} {order.last_name}</b><small>{order.email}</small></td><td><b>{money(order.total)}</b><small>{order.order_items?.length || 0} lines</small></td>{detailed && <td><b>{orderStatusLabel(order.payment_method)}</b><small>{order.payment_status}</small></td>}<td><select className={`status-select ${order.status}`} value={order.status} onChange={(e) => onUpdate(order.id, e.target.value)}>{statuses.map((status) => <option value={status} key={status}>{orderStatusLabel(status)}</option>)}</select></td></tr>)}</tbody></table>{!orders.length && <div className="empty-state compact"><h3>No orders yet</h3></div>}</div>;
}
