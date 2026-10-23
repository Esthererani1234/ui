import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  BarChart3,
  Copy,
  DollarSign,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  MessagesSquare,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { invokeFunction } from "../lib/functionRequest";
import { orderChanges, orderStatusBlock } from "../lib/adminOrder";
import { supabase } from "../lib/supabase";
import { money, orderStatusLabel, spotAdjustmentLabel } from "../lib/pricing";
import {
  AuditAdminPanel,
  CustomerAdminPanel,
  RiskAdminPanel,
  SecurityAdminPanel,
  SalesAdminPanel,
  StoreAdminPanel,
} from "../components/admin/EnterprisePanels";
import TrafficAnalyticsPanel from "../components/admin/TrafficAnalyticsPanel";
import OrderStatus from "../components/OrderStatus";
import SupportAdminPanel from "../components/admin/SupportAdminPanel";
import SellAdminPanel from "../components/admin/SellAdminPanel";

const blankProduct = {
  name: "",
  slug: "",
  sku: "",
  short_description: "",
  description: "",
  features: [],
  metal: "gold",
  category: "coin",
  metal_weight_oz: 1,
  price_mode: "dynamic",
  fixed_price: "",
  premium_fixed: 0,
  premium_percent: 0,
  shipping_fee: null,
  free_shipping_minimum: null,
  inventory_count: 0,
  low_stock_threshold: 3,
  is_active: false,
  is_featured: false,
  badge: "",
  image_url: "",
  image_urls: [],
  sort_order: 100,
};
const ADMIN_PAGE_SIZE = 25;
const tabTitles = {
  overview: "Dashboard",
  products: "Products & pricing",
  orders: "Order management",
  sales: "Sales reporting",
  traffic: "Storefront traffic",
  support: "Customer support",
  sell: "Sell requests",
  customers: "Customer operations",
  risk: "Fraud & risk center",
  security: "Security controls",
  store: "Store settings",
  audit: "Admin audit trail",
};
const statuses = [
  "pending_review",
  "awaiting_payment",
  "payment_received",
  "processing",
  "shipped",
  "completed",
  "cancelled",
];
const orderFields =
  "id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, payment_provider, provider_payment_id, payment_reference, payment_due_at, paid_at, terms_version, terms_accepted_at, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number, created_at, updated_at, order_items(*)";
const imagePath = (url) => {
  const marker = "/storage/v1/object/public/product-images/";
  return url?.includes(marker)
    ? decodeURIComponent(url.split(marker)[1])
    : null;
};
const productGallery = (product) => {
  const urls = Array.isArray(product?.image_urls) ? product.image_urls : [];
  return [...new Set([product?.image_url, ...urls].filter(Boolean))].slice(
    0,
    8,
  );
};
const prepareProductEditor = (product) => {
  const gallery = productGallery(product);
  return {
    ...product,
    features: Array.isArray(product?.features) ? product.features : [],
    image_url: gallery[0] || "",
    image_urls: gallery,
    _original_image_urls: gallery,
  };
};

export default function AdminPage() {
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return Object.hasOwn(tabTitles, requested) ? requested : "overview";
  });
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [editor, setEditor] = useState(null);
  const [shippingDefaults,setShippingDefaults]=useState({shipping_flat:35,free_shipping_threshold:5000});
  useEffect(()=>{supabase.from("app_settings").select("key,value").in("key",["shipping_flat","free_shipping_threshold"]).then(({data})=>{if(data)setShippingDefaults(current=>data.reduce((next,row)=>({...next,[row.key]:Number(row.value)}),current));});},[]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [temporaryImagePaths, setTemporaryImagePaths] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [aal, setAal] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogMetal, setCatalogMetal] = useState("all");
  const [catalogStatus, setCatalogStatus] = useState("all");
  const [catalogPage, setCatalogPage] = useState(1);
  const [loadBusy, setLoadBusy] = useState(false);
  const loadVersion = useRef(0);
  const [orderFilter, setOrderFilter] = useState("all");

  const load = async () => {
    const version = ++loadVersion.current;
    setLoadBusy(true);
    try {
    const [
      { data: productData, error: productError },
      { data: orderData, error: orderError },
    ] = await Promise.all([
      supabase.from("products").select("*").order("sort_order"),
      supabase
        .from("orders")
        .select(orderFields)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (version !== loadVersion.current) return;
    if (!productError) setProducts(productData || []);
    if (!orderError) setOrders(orderData || []);
    const failures = [
      productError && "products",
      orderError && "orders",
    ].filter(Boolean);
    setMessage(
      failures.length
        ? `${failures.join(", ")} could not be refreshed. Your last loaded data is still shown. Retry below.`
        : "",
    );
    } catch { if (version === loadVersion.current) setMessage("The admin connection was interrupted. Retry loading your data."); }
    finally { if (version === loadVersion.current) setLoadBusy(false); }
  };
  useEffect(() => () => { loadVersion.current += 1; }, []);
  useEffect(() => {
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => setAal(data?.currentLevel || "aal1"));
  }, []);
  useEffect(() => {
    if (aal === "aal2") load();
  }, [aal]);
  useEffect(() => {
    if (aal !== "aal2") return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        async () => {
          await supabase.auth.signOut();
          window.location.assign("/login");
        },
        15 * 60 * 1000,
      );
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) =>
      window.addEventListener(event, reset, { passive: true }),
    );
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [aal]);
  useEffect(() => {
    if (editor || !temporaryImagePaths.length) return;
    supabase.storage.from("product-images").remove(temporaryImagePaths);
    setTemporaryImagePaths([]);
  }, [editor, temporaryImagePaths]);

  const metrics = useMemo(
    () => ({
      revenue: orders
        .filter((o) => o.payment_status === "paid" && o.status !== "cancelled")
        .reduce((sum, o) => sum + Number(o.total), 0),
      open: orders.filter((o) => !["completed", "cancelled"].includes(o.status))
        .length,
      lowStock: products.filter(
        (p) => p.inventory_count <= p.low_stock_threshold,
      ).length,
    }),
    [orders, products],
  );

  const filteredOrders = useMemo(() => {
    if (orderFilter === "all") return orders;
    if (orderFilter === "refunded")
      return orders.filter((order) => order.payment_status === "refunded");
    if (orderFilter === "open")
      return orders.filter(
        (order) => !["completed", "cancelled"].includes(order.status),
      );
    return orders.filter((order) => order.status === orderFilter);
  }, [orders, orderFilter]);

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return products.filter((product) => {
      if (catalogMetal !== "all" && product.metal !== catalogMetal) return false;
      if (query && !`${product.name} ${product.sku}`.toLowerCase().includes(query))
        return false;
      if (catalogStatus === "live" && !product.is_active) return false;
      if (catalogStatus === "draft" && product.is_active) return false;
      if (catalogStatus === "featured" && !product.is_featured) return false;
      if (
        catalogStatus === "low" &&
        product.inventory_count > product.low_stock_threshold
      )
        return false;
      return true;
    });
  }, [products, catalogQuery, catalogMetal, catalogStatus]);
  const catalogPageCount = Math.max(
    1,
    Math.ceil(filteredCatalog.length / ADMIN_PAGE_SIZE),
  );
  const pagedCatalog = filteredCatalog.slice(
    (catalogPage - 1) * ADMIN_PAGE_SIZE,
    catalogPage * ADMIN_PAGE_SIZE,
  );

  useEffect(() => setCatalogPage(1), [catalogQuery, catalogMetal, catalogStatus]);
  useEffect(() => {
    if (catalogPage > catalogPageCount) setCatalogPage(catalogPageCount);
  }, [catalogPage, catalogPageCount]);

  const saveProduct = async (event) => {
    event.preventDefault();
    setMessage("");
    const adjustment = Number(editor.premium_percent);
    if (!Number.isFinite(adjustment) || adjustment < -99 || adjustment > 99)
      return setMessage("Spot adjustment must be between -99% and +99%.");
    for (const [field,max] of [["shipping_fee",10000],["free_shipping_minimum",1000000]]) {
      const value=editor[field];
      if(value != null && value !== "" && (!Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>max)) return setMessage("Enter a valid, non-negative shipping amount.");
    }
    const gallery = [
      ...new Set((editor.image_urls || []).filter(Boolean)),
    ].slice(0, 8);
    const originalImageUrls = editor._original_image_urls || [];
    const payload = {
      ...editor,
      features: (editor.features || [])
        .map((feature) => feature.trim())
        .filter(Boolean)
        .slice(0, 12),
      image_url: gallery[0] || null,
      image_urls: gallery,
      price_mode: "dynamic",
      fixed_price: null,
      premium_fixed: 0,
      premium_percent: adjustment,
    };
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;
    delete payload._original_image_urls;
    for (const key of [
      "shipping_fee",
      "free_shipping_minimum",
      "metal_weight_oz",
      "fixed_price",
      "premium_fixed",
      "premium_percent",
      "inventory_count",
      "low_stock_threshold",
      "sort_order",
    ])
      payload[key] = payload[key] == null || payload[key] === "" ? null : Number(payload[key]);
    const result = editor.id
      ? await supabase.from("products").update(payload).eq("id", editor.id)
      : await supabase.from("products").insert(payload);
    if (result.error) return setMessage(result.error.message);
    const removedPaths = originalImageUrls
      .filter((url) => !gallery.includes(url))
      .map(imagePath)
      .filter(Boolean);
    if (removedPaths.length)
      await supabase.storage.from("product-images").remove(removedPaths);
    setTemporaryImagePaths([]);
    setEditor(null);
    await load();
  };


  const saveOrderDetails = async (updates) => {
    setMessage("");
    await invokeFunction(supabase,"admin-operations",{action:"update_order",...updates});
    setSelectedOrder(null);
    await load();
    return true;
  };

  const openOrderDetails = async (order, intent = "manage") => {
    setMessage("");
    try {
      const data = await invokeFunction(supabase, "admin-operations", { action: "get_order_details", order_id: order.id });
      if (!data?.order) throw new Error("The order details could not be loaded.");
      setSelectedOrder({ ...data.order, admin_intent: intent });
    } catch (error) { setMessage(error.message); }
  };

  const uploadProductImages = async (event) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const currentGallery = productGallery(editor);
    const availableSlots = 8 - currentGallery.length;
    if (availableSlots < 1)
      return setMessage("This product already has the maximum of 8 pictures.");
    const files = selected.slice(0, availableSlots);
    if (
      files.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            file.type,
          ),
      )
    )
      return setMessage("Choose JPG, PNG, WebP, or GIF picture files.");
    if (files.some((file) => file.size > 5 * 1024 * 1024))
      return setMessage("Each picture must be 5 MB or smaller.");
    setUploading(true);
    setMessage("");
    const uploadedUrls = [];
    const uploadedPaths = [];
    for (const file of files) {
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
      const path = `${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (error) {
        if (uploadedPaths.length)
          await supabase.storage.from("product-images").remove(uploadedPaths);
        setUploading(false);
        setMessage(
          "One of the pictures could not be uploaded. Please try again.",
        );
        return;
      }
      const { data } = supabase.storage
        .from("product-images")
        .getPublicUrl(path);
      uploadedPaths.push(path);
      uploadedUrls.push(data.publicUrl);
    }
    setEditor((current) => ({
      ...current,
      image_url: productGallery(current)[0] || uploadedUrls[0],
      image_urls: [...productGallery(current), ...uploadedUrls].slice(0, 8),
    }));
    setTemporaryImagePaths((current) => [...current, ...uploadedPaths]);
    if (selected.length > files.length)
      setMessage(
        "Only the first pictures were added because each product can have up to 8.",
      );
    setUploading(false);
  };

  const makePrimaryImage = (url) => {
    setEditor((current) => ({
      ...current,
      image_url: url,
      image_urls: [
        url,
        ...productGallery(current).filter((item) => item !== url),
      ],
    }));
  };

  const removeProductImage = async (url) => {
    const original = editor._original_image_urls || [];
    const path = imagePath(url);
    if (!original.includes(url) && path) {
      await supabase.storage.from("product-images").remove([path]);
      setTemporaryImagePaths((current) =>
        current.filter((item) => item !== path),
      );
    }
    setEditor((current) => {
      const gallery = productGallery(current).filter((item) => item !== url);
      return { ...current, image_url: gallery[0] || "", image_urls: gallery };
    });
  };

  const duplicateProduct = (product) => {
    setEditor(
      prepareProductEditor({
        ...product,
        id: undefined,
        name: `${product.name} Copy`,
        slug: "",
        sku: "",
        is_active: false,
        is_featured: false,
        badge: "",
        image_url: "",
        image_urls: [],
      }),
    );
  };

  if (aal === null)
    return <div className="page-loader">Checking administrator security…</div>;
  if (aal !== "aal2") return <AdminMfaGate onVerified={() => setAal("aal2")} />;

  return (
    <section className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-wordmark">
          <span>G</span>
          <b>GOTS Admin</b>
        </div>
        <nav>
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            <LayoutDashboard /> Overview
          </button>
          <button
            className={tab === "products" ? "active" : ""}
            onClick={() => setTab("products")}
          >
            <Boxes /> Products
          </button>
          <button
            className={tab === "orders" ? "active" : ""}
            onClick={() => setTab("orders")}
          >
            <ShoppingBag /> Orders
          </button>
          <button
            className={tab === "sales" ? "active" : ""}
            onClick={() => setTab("sales")}
          >
            <BarChart3 /> Sales
          </button>
          <button
            className={tab === "traffic" ? "active" : ""}
            onClick={() => setTab("traffic")}
          >
            <Activity /> Traffic
          </button>
          <button
            className={tab === "sell" ? "active" : ""}
            onClick={() => setTab("sell")}
          >
            <DollarSign /> Sell requests
          </button>
          <button
            className={tab === "support" ? "active" : ""}
            onClick={() => setTab("support")}
          >
            <MessagesSquare /> Support
          </button>
          <button
            className={tab === "customers" ? "active" : ""}
            onClick={() => setTab("customers")}
          >
            <Users /> Customers
          </button>
          <button
            className={tab === "risk" ? "active" : ""}
            onClick={() => setTab("risk")}
          >
            <ShieldAlert /> Risk center
          </button>
          <button
            className={tab === "security" ? "active" : ""}
            onClick={() => setTab("security")}
          >
            <Settings /> Security
          </button>
          <button
            className={tab === "store" ? "active" : ""}
            onClick={() => setTab("store")}
          >
            <Store /> Store settings
          </button>
          <button
            className={tab === "audit" ? "active" : ""}
            onClick={() => setTab("audit")}
          >
            <ScrollText /> Audit log
          </button>
        </nav>
        <a href="/">← Return to storefront</a>
      </aside>
      <div className="admin-main">
        <header>
          <div>
            <span>GOLDONTHESPOT OPERATIONS</span>
            <h1>{tabTitles[tab] || "Operations"}</h1>
          </div>
          {tab === "products" && (
            <button
              className="button button-gold"
              onClick={() => setEditor(prepareProductEditor(blankProduct))}
            >
              <Plus size={17} /> Add product
            </button>
          )}
        </header>
        {message && <div className="form-message error" role="alert">{message} <button type="button" className="text-button" disabled={loadBusy} onClick={load}>{loadBusy ? "Loading…" : "Retry loading"}</button></div>}
        {tab === "overview" && (
          <>
            <div className="metric-grid">
              <button
                type="button"
                className="metric-card"
                onClick={() => setTab("sales")}
              >
                <DollarSign />
                <span>
                  <small>ORDER VALUE</small>
                  <b>{money(metrics.revenue)}</b>
                  <em>non-cancelled reviewed orders</em>
                </span>
              </button>
              <button
                type="button"
                className="metric-card"
                onClick={() => {
                  setOrderFilter("open");
                  setTab("orders");
                }}
              >
                <PackageCheck />
                <span>
                  <small>OPEN ORDERS</small>
                  <b>{metrics.open}</b>
                  <em>requiring fulfillment activity</em>
                </span>
              </button>
              <button
                type="button"
                className="metric-card"
                onClick={() => {
                  setCatalogStatus("low");
                  setTab("products");
                }}
              >
                <Boxes />
                <span>
                  <small>LOW STOCK</small>
                  <b>{metrics.lowStock}</b>
                  <em>at or below alert threshold</em>
                </span>
              </button>
              <button
                type="button"
                className="metric-card"
                onClick={() => {
                  setOrderFilter("all");
                  setTab("orders");
                }}
              >
                <ShoppingBag />
                <span>
                  <small>TOTAL ORDERS</small>
                  <b>{orders.length}</b>
                  <em>latest 100 loaded</em>
                </span>
              </button>
            </div>
            <div className="admin-panel">
              <div className="panel-title">
                <h2>Recent orders</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("orders")}
                >
                  View all
                </button>
              </div>
              <OrderTable
                orders={orders.slice(0, 8)}
                onOpen={openOrderDetails}
              />
            </div>
          </>
        )}
        {tab === "products" && (
          <div className="admin-panel">
            <div className="panel-title">
              <div>
                <h2>Catalog</h2>
                <p>
                  Every product price follows the selected metal's live spot
                  price.
                </p>
              </div>
            </div>
            <div className="admin-catalog-summary">
              <button type="button" onClick={() => setCatalogStatus("all")}>
                <b>{products.length}</b>
                <span>Total products</span>
              </button>
              <button type="button" onClick={() => setCatalogStatus("live")}>
                <b>{products.filter((product) => product.is_active).length}</b>
                <span>Live</span>
              </button>
              <button type="button" onClick={() => setCatalogStatus("draft")}>
                <b>{products.filter((product) => !product.is_active).length}</b>
                <span>Drafts</span>
              </button>
              <button type="button" onClick={() => setCatalogStatus("low")}>
                <b>{metrics.lowStock}</b>
                <span>Low stock</span>
              </button>
            </div>
            <div className="admin-catalog-toolbar">
              <label className="admin-catalog-search">
                <Search size={17} />
                <span className="sr-only">Search products</span>
                <input
                  type="search"
                  placeholder="Search name or SKU…"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Filter by metal</span>
                <select
                  value={catalogMetal}
                  onChange={(event) => setCatalogMetal(event.target.value)}
                >
                  <option value="all">All metals</option>
                  <option value="gold">Gold</option>
                  <option value="silver">Silver</option>
                  <option value="platinum">Platinum</option>
                  <option value="palladium">Palladium</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Filter by catalog status</span>
                <select
                  value={catalogStatus}
                  onChange={(event) => setCatalogStatus(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="live">Live</option>
                  <option value="draft">Draft</option>
                  <option value="featured">Homepage featured</option>
                  <option value="low">Low stock</option>
                </select>
              </label>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table catalog-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Live pricing rule</th>
                    <th>Inventory</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCatalog.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <b>{product.name}</b>
                        <small>
                          {product.sku} • {product.metal_weight_oz} oz pure{" "}
                          {product.metal}
                        </small>
                      </td>
                      <td data-label="Pricing rule">
                        <b>{spotAdjustmentLabel(product.premium_percent)}</b>
                      </td>
                      <td data-label="Stock">
                        <b
                          className={
                            product.inventory_count <=
                            product.low_stock_threshold
                              ? "danger-text"
                              : ""
                          }
                        >
                          {product.inventory_count}
                        </b>
                      </td>
                      <td data-label="Status">
                        <span
                          className={
                            product.is_active
                              ? "status-pill completed"
                              : "status-pill cancelled"
                          }
                        >
                          {product.is_active ? "Live" : "Draft"}
                        </span>
                      </td>
                      <td className="admin-product-actions">
                        <button
                          className="icon-button"
                          onClick={() => duplicateProduct(product)}
                          aria-label={`Duplicate ${product.name}`}
                          title="Duplicate as a draft"
                        >
                          <Copy size={17} />
                        </button>
                        <button
                          className="icon-button"
                          onClick={() =>
                            setEditor(prepareProductEditor(product))
                          }
                          aria-label={`Edit ${product.name}`}
                          title="Edit product"
                        >
                          <Pencil size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!pagedCatalog.length && (
                    <tr>
                      <td colSpan="5">
                        <div className="empty-state compact">
                          <h3>No matching products</h3>
                          <p>Try another search or clear the catalog filters.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="admin-catalog-pagination">
              <span>
                {filteredCatalog.length} match
                {filteredCatalog.length === 1 ? "" : "es"} • Page {catalogPage} of{" "}
                {catalogPageCount}
              </span>
              <div>
                <button
                  className="button button-outline"
                  disabled={catalogPage <= 1}
                  onClick={() => setCatalogPage((page) => page - 1)}
                >
                  Previous
                </button>
                <button
                  className="button button-outline"
                  disabled={catalogPage >= catalogPageCount}
                  onClick={() => setCatalogPage((page) => page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
        {tab === "orders" && (
          <div className="admin-panel">
            <div className="panel-title">
              <div>
                <h2>All orders</h2>
                <p>Use the action buttons on each order to change status, add tracking, or cancel.</p>
              </div>
              <select
                className="admin-order-filter"
                aria-label="Order status filter"
                value={orderFilter}
                onChange={(event) => setOrderFilter(event.target.value)}
              >
                <option value="all">All orders</option>
                <option value="open">All open orders</option>
                <option value="refunded">Refunded</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {orderStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <OrderTable
              orders={filteredOrders}
              onOpen={openOrderDetails}
              detailed
            />
          </div>
        )}
        {tab === "sales" && <SalesAdminPanel />}
        {tab === "traffic" && <TrafficAnalyticsPanel />}
        {tab === "support" && <SupportAdminPanel />}
        {tab === "sell" && <SellAdminPanel />}
        {tab === "customers" && <CustomerAdminPanel />}
        {tab === "risk" && <RiskAdminPanel />}
        {tab === "security" && <SecurityAdminPanel />}
        {tab === "store" && <StoreAdminPanel />}
        {tab === "audit" && <AuditAdminPanel />}
      </div>
      {editor && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="product-editor"
            onSubmit={saveProduct}
            role="dialog"
            aria-modal="true"
            aria-label={editor.id ? "Edit product" : "Add product"}
          >
            <header>
              <div>
                <small>CATALOG EDITOR</small>
                <h2>{editor.id ? "Edit product" : "Add product"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditor(null)}
              >
                <X />
              </button>
            </header>
            <div className="editor-scroll">
              {message && <div className="form-message error" role="alert">{message}</div>}
              <div className="editor-section editor-section-card">
                <h3>Shipping</h3>
                <p>Set the shipping fee and the merchandise subtotal needed for free shipping when this product is in the cart.</p>
                <div className="form-row">
                  <label>Shipping fee ($)<input type="number" min="0" max="10000" step="0.01" value={editor.shipping_fee ?? ''} placeholder={`Store default (${money(shippingDefaults.shipping_flat)})`} onChange={e=>setEditor({...editor,shipping_fee:e.target.value})}/></label>
                  <label>Free shipping minimum ($)<input type="number" min="0" max="1000000" step="0.01" value={editor.free_shipping_minimum ?? ''} placeholder={`Store default (${money(shippingDefaults.free_shipping_threshold)})`} onChange={e=>setEditor({...editor,free_shipping_minimum:e.target.value})}/></label>
                </div>
                <p className="field-help">Leave a field blank to use Store settings. Enter 0 for the minimum to always qualify for free shipping. Mixed carts pay the highest applicable shipping fee once. Thresholds use the full merchandise subtotal before payment fees and taxes. Existing price locks keep their quoted shipping.</p>
              </div>
              <div className="editor-section editor-section-card">
                <div className="editor-section-heading">
                  <span>1</span>
                  <div>
                    <h3>Product pictures</h3>
                    <p>Upload several angles so buyers can swipe and magnify.</p>
                  </div>
                </div>
                <div className="product-image-editor">
                <div className="image-preview">
                  {editor.image_url ? (
                    <img src={editor.image_url} alt="Product preview" />
                  ) : (
                    <span>
                      <ImagePlus />
                      <b>No product pictures yet</b>
                      <small>Add up to 8 JPG, PNG, WebP, or GIF files</small>
                    </span>
                  )}
                </div>
                <div>
                  <label className="button button-dark upload-button">
                    <ImagePlus size={17} />{" "}
                    {uploading ? "Uploading pictures…" : "Add pictures"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      onChange={uploadProductImages}
                      disabled={uploading}
                    />
                  </label>
                  <p>
                    Add up to 8 pictures. The first picture is the main shop
                    image. Select any thumbnail below to make it the main image.
                  </p>
                </div>
                </div>
                {productGallery(editor).length > 0 && (
                  <div className="product-image-gallery-editor">
                    {productGallery(editor).map((url, index) => (
                      <div className="gallery-editor-item" key={url}>
                        <button
                          type="button"
                          className={index === 0 ? "primary" : ""}
                          onClick={() => makePrimaryImage(url)}
                          aria-label={`Make picture ${index + 1} the main image`}
                        >
                          <img src={url} alt={`Product picture ${index + 1}`} />
                          <span>
                            {index === 0
                              ? "Main image"
                              : `Picture ${index + 1}`}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="gallery-remove"
                          onClick={() => removeProductImage(url)}
                          aria-label={`Remove product picture ${index + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="editor-section editor-section-card">
                <div className="editor-section-heading">
                  <span>2</span>
                  <div>
                    <h3>Product information</h3>
                    <p>The details customers use to understand and find this item.</p>
                  </div>
                </div>
              <div className="form-row">
                <label>
                  Product name
                  <input
                    required
                    value={editor.name}
                    onChange={(e) =>
                      setEditor({ ...editor, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  SKU
                  <input
                    required
                    value={editor.sku}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        sku: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                URL slug
                <input
                  required
                  value={editor.slug}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, ""),
                    })
                  }
                />
              </label>
              <label>
                Short description
                <input
                  value={editor.short_description || ""}
                  onChange={(e) =>
                    setEditor({ ...editor, short_description: e.target.value })
                  }
                />
              </label>
              <label>
                Full description
                <textarea
                  rows="4"
                  value={editor.description || ""}
                  onChange={(e) =>
                    setEditor({ ...editor, description: e.target.value })
                  }
                />
              </label>
              <div className="form-row three">
                <label>
                  Metal
                  <select
                    value={editor.metal}
                    onChange={(e) =>
                      setEditor({ ...editor, metal: e.target.value })
                    }
                  >
                    <option value="gold">Gold</option>
                    <option value="silver">Silver</option>
                    <option value="platinum">Platinum</option>
                    <option value="palladium">Palladium</option>
                  </select>
                </label>
                <label>
                  Type
                  <select
                    value={editor.category}
                    onChange={(e) =>
                      setEditor({ ...editor, category: e.target.value })
                    }
                  >
                    <option>coin</option>
                    <option>bar</option>
                    <option>round</option>
                  </select>
                </label>
                <label>
                  Pure metal weight (troy oz)
                  <input
                    type="number"
                    step="0.000001"
                    min="0.000001"
                    required
                    value={editor.metal_weight_oz}
                    onChange={(e) =>
                      setEditor({ ...editor, metal_weight_oz: e.target.value })
                    }
                  />
                </label>
              </div>
              </div>
              <div className="editor-section editor-section-card">
                <div className="editor-section-heading">
                  <span>3</span>
                  <div>
                    <h3>Customer-facing highlights</h3>
                    <p>One benefit or product fact per line, up to 12.</p>
                  </div>
                </div>
                <label>
                  Key features
                  <textarea
                    rows="6"
                    placeholder={
                      "Contains 1 troy oz of .9999 fine gold\nEligible for precious metals IRAs\nShips in protective packaging"
                    }
                    value={(editor.features || []).join("\n")}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        features: event.target.value.split("\n").slice(0, 12),
                      })
                    }
                  />
                  <small className="field-help">
                    {(editor.features || []).filter((feature) => feature.trim()).length}
                    /12 highlights
                  </small>
                </label>
              </div>
              <div className="editor-section editor-section-card spot-pricing-section">
                <div className="editor-section-heading">
                  <span>4</span>
                  <div>
                    <h3>Live spot pricing</h3>
                    <p>Set the automatic price rule for this product.</p>
                  </div>
                </div>
                <p>
                  Price = live {editor.metal} spot × pure weight × spot
                  adjustment.
                </p>
                <label>
                  Percentage above or below spot
                  <input
                    type="number"
                    step="0.01"
                    min="-99"
                    max="99"
                    required
                    value={editor.premium_percent}
                    onChange={(e) =>
                      setEditor({ ...editor, premium_percent: e.target.value })
                    }
                  />
                  <small className="field-help">
                    Enter -2 for 2% below spot, 0 for spot, or 3.5 for 3.5%
                    above spot. Current rule:{" "}
                    {spotAdjustmentLabel(editor.premium_percent)}
                  </small>
                </label>
              </div>
              <div className="editor-section editor-section-card">
                <div className="editor-section-heading">
                  <span>5</span>
                  <div>
                    <h3>Inventory & display</h3>
                    <p>Control availability and where the product appears.</p>
                  </div>
                </div>
                <div className="form-row three">
                  <label>
                    Available units
                    <input
                      type="number"
                      min="0"
                      value={editor.inventory_count}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          inventory_count: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Low-stock alert
                    <input
                      type="number"
                      min="0"
                      value={editor.low_stock_threshold}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          low_stock_threshold: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Display position
                    <input
                      type="number"
                      value={editor.sort_order}
                      onChange={(e) =>
                        setEditor({ ...editor, sort_order: e.target.value })
                      }
                    />
                    <small className="field-help">
                      Lower numbers appear earlier in the shop. This is not a
                      price.
                    </small>
                  </label>
                </div>
                <label>
                  Badge
                  <input
                    placeholder="BEST SELLER"
                    value={editor.badge || ""}
                    onChange={(e) =>
                      setEditor({ ...editor, badge: e.target.value })
                    }
                  />
                </label>
                <div className="toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={editor.is_active}
                      onChange={(e) =>
                        setEditor({ ...editor, is_active: e.target.checked })
                      }
                    />{" "}
                    Product is live
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={editor.is_featured}
                      onChange={(e) =>
                        setEditor({ ...editor, is_featured: e.target.checked })
                      }
                    />{" "}
                    Feature on homepage
                  </label>
                </div>
              </div>
            </div>
            <footer>
              <button
                type="button"
                className="button button-outline"
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="button button-gold" disabled={uploading}>
                Save product
              </button>
            </footer>
          </form>
        </div>
      )}
      {selectedOrder && (
        <OrderDetailModal
          key={selectedOrder.id}
          order={selectedOrder}
          onReview={() => { setSelectedOrder(null); setTab("risk"); }}
          onClose={() => setSelectedOrder(null)}
          onSave={saveOrderDetails}
        />
      )}
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
      const { data: factors, error: listError } =
        await supabase.auth.mfa.listFactors();
      if (listError) {
        if (active) {
          setMessage(listError.message);
          setLoading(false);
        }
        return;
      }
      const verified = factors?.totp?.find(
        (factor) => factor.status === "verified",
      );
      if (verified) {
        if (active) {
          setFactorId(verified.id);
          setLoading(false);
        }
        return;
      }
      const pending =
        factors?.totp?.filter((factor) => factor.status !== "verified") || [];
      await Promise.all(
        pending.map((factor) =>
          supabase.auth.mfa.unenroll({ factorId: factor.id }),
        ),
      );
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "GoldOnTheSpot Admin",
      });
      if (!active) return;
      if (error) setMessage(error.message);
      else {
        setEnrollment(data);
        setFactorId(data.id);
      }
      setLoading(false);
    };
    prepare();
    return () => {
      active = false;
    };
  }, []);

  const verify = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code))
      return setMessage(
        "Enter the six-digit code from your authenticator app.",
      );
    setVerifying(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (error) {
      setMessage(error.message);
      setVerifying(false);
      return;
    }
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setVerifying(false);
    if (data?.currentLevel === "aal2") onVerified();
    else
      setMessage("Two-factor verification did not complete. Please try again.");
  };

  return (
    <section className="mfa-shell">
      <div className="mfa-card">
        <ShieldCheck className="mfa-shield" />
        <span className="eyebrow dark">ADMIN PROTECTION</span>
        <h1>Two-factor verification required</h1>
        <p>
          {enrollment
            ? "Before this administrator account can change products or orders, connect an authenticator app."
            : "Enter the current code from your authenticator app to unlock the dashboard."}
        </p>
        {loading ? (
          <div className="catalog-loading">Preparing secure verification…</div>
        ) : (
          <>
            {enrollment && (
              <div className="mfa-enrollment">
                <img
                  src={enrollment.totp.qr_code}
                  alt="Authenticator QR code"
                />
                <div>
                  <b>1. Scan this QR code</b>
                  <span>
                    Use Google Authenticator, Microsoft Authenticator, Authy, or
                    another TOTP app.
                  </span>
                  <b>2. Save this backup setup key</b>
                  <code>{enrollment.totp.secret}</code>
                </div>
              </div>
            )}
            <form onSubmit={verify}>
              <label>
                <Smartphone /> Six-digit authenticator code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength="6"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="000000"
                />
              </label>
              {message && <div className="form-message error">{message}</div>}
              <button
                className="button button-gold full large"
                disabled={verifying || !factorId}
              >
                <LockKeyhole size={17} />{" "}
                {verifying ? "Verifying…" : "Unlock admin dashboard"}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}

function OrderTable({ orders, onOpen }) {
  return (
    <div className="admin-order-list">
      {orders.map((order) => (
        <article className="admin-order-row" key={order.id}>
          <header>
            <div><b>{order.order_number}</b><small>{new Date(order.created_at).toLocaleString()}</small></div>
            <OrderStatus order={order} />
          </header>
          <div className="admin-order-summary">
            <div><small>Customer</small><b>{order.first_name} {order.last_name}</b><span>{order.email}</span></div>
            <div><small>Total</small><b>{money(order.total)}</b><span>{order.order_items?.length || 0} item lines</span></div>
            <div><small>Payment</small><b>{orderStatusLabel(order.payment_method)}</b><span>{orderStatusLabel(order.payment_status)}</span></div>
            {order.tracking_number && <div><small>Tracking</small><b>{order.tracking_number}</b></div>}
          </div>
          <div className="admin-order-actions" aria-label={`Actions for ${order.order_number}`}>
            <button type="button" className="button button-dark" onClick={() => onOpen(order)}>Manage order</button>
            <button type="button" className="button button-outline" onClick={() => onOpen(order, "tracking")}>Add / edit tracking</button>
            {!["shipped", "completed", "cancelled"].includes(order.status) && <button type="button" className="button button-outline" onClick={() => onOpen(order, "shipped")}>Mark shipped</button>}
            {!["completed", "cancelled"].includes(order.status) && <button type="button" className="button button-outline" disabled={order.status !== "shipped"} title={order.status === "shipped" ? "Record delivery" : "Mark the order shipped before recording delivery"} onClick={() => onOpen(order, "completed")}>Mark delivered</button>}
            {!["shipped", "completed", "cancelled"].includes(order.status) && <button type="button" className="button button-outline danger-text" onClick={() => onOpen(order, "cancelled")}>Cancel order</button>}
          </div>
        </article>
      ))}
      {!orders.length && <div className="empty-state compact"><h3>No orders yet</h3></div>}
    </div>
  );
}

function OrderDetailModal({ order, onClose, onSave, onReview }) {
  const [form, setForm] = useState({
    status: ["shipped", "completed", "cancelled"].includes(order.admin_intent) ? order.admin_intent : order.status,
    paymentStatus: order.payment_status,
    trackingNumber: order.tracking_number || "",
    internalNotes: order.internal_notes || "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const address = order.shipping_address || {};
  const blocked = orderStatusBlock(order, form.status, form.paymentStatus);
  const changed = Object.keys(orderChanges(order, form)).length > 2;
  const submit = async (event) => {
    event.preventDefault();
    if (saving || !changed) return;
    setError("");
    if (form.reason.trim().length < 3) return setError("Enter a short reason for this change.");
    if (blocked) return setError(blocked);
    setSaving(true);
    try { await onSave(orderChanges(order, form)); }
    catch (error) { setError(error.message || "Could not save this order. Try again."); }
    finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop">
      <form className="order-detail-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="admin-order-title">
        <header>
          <div><small>ORDER OPERATIONS</small><h2 id="admin-order-title">{order.order_number}</h2><span>{new Date(order.created_at).toLocaleString()}</span></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={saving}><X /></button>
        </header>
        <div className="order-detail-scroll">
          <section className="order-admin-controls">
            <h3>Update status & tracking</h3>
            <div className="form-row">
              <label>Order status<select disabled={saving} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{statuses.map((status) => <option key={status} value={status} disabled={Boolean(orderStatusBlock(order, status, form.paymentStatus))}>{status === "completed" ? "Delivered / completed" : orderStatusLabel(status)}</option>)}</select></label>
              <label>Payment status<select disabled={saving || order.payment_method !== "wire" || order.status === "cancelled"} value={form.paymentStatus} onChange={(event) => setForm({ ...form, paymentStatus: event.target.value, status: event.target.value === "paid" && ["pending_review", "awaiting_payment"].includes(form.status) ? "payment_received" : form.status })}>{["unpaid", "pending", "confirming", "paid", "partially_paid", "expired", "refunded", "failed", "disputed"].map((status) => <option key={status} value={status}>{orderStatusLabel(status)}</option>)}</select></label>
            </div>
            {order.payment_method !== "wire" && <p className="field-help">Payment status is confirmed by the payment provider. Review flagged orders in the risk center before processing or shipping.</p>}
            <p className="field-help">Tracking and notes can be saved without changing order or payment status. Add a short audit reason, then save.</p>
            {form.paymentStatus !== "paid" && <p className="field-help">Shipping is locked until payment is confirmed. {order.payment_method === "wire" ? "For a received wire, set Payment status to Paid." : "Card and crypto payments must be confirmed by the provider."}</p>}
            {order.risk_decision && order.risk_decision !== "approved" && <p className="field-help">Risk review: {orderStatusLabel(order.risk_decision)}. <button type="button" className="text-button" disabled={saving} onClick={onReview}>Open Risk center</button> to approve before shipping.</p>}
            {form.status === "shipped" && order.status !== "processing" && <p className="field-help">Saving will record processing and shipment together after checking payment and risk approval.</p>}
            <label>Tracking number<input autoFocus={order.admin_intent === "tracking"} disabled={saving} maxLength="200" value={form.trackingNumber} onChange={(event) => setForm({ ...form, trackingNumber: event.target.value })} /></label>
            <label>Private internal notes<textarea disabled={saving} rows="5" maxLength="5000" value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} /></label>
            <label>Required audit reason<textarea disabled={saving} required minLength="3" rows="3" maxLength="1000" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Why are you changing this order?" /></label>
            {form.status === "cancelled" && order.status !== "cancelled" && <div className="form-message error">Cancellation returns reserved quantities to inventory. It does not refund a payment. Cancelled orders cannot be reopened automatically.</div>}
          </section>
          <div className="order-detail-facts">
            <div><span>Customer</span><b>{order.first_name} {order.last_name}</b><small>{order.email}<br />{order.phone}</small></div>
            <div><span>Shipping address</span><b>{address.address_line_1}</b><small>{[address.address_line_2, address.city, address.state, address.postal_code, address.country].filter(Boolean).join(", ")}</small></div>
            <div><span>Order total</span><b>{money(order.total)}</b><small>{order.payment_method} • {order.payment_status}<br />{order.payment_provider || "No provider"}{order.provider_payment_id ? ` • ${order.provider_payment_id}` : ""}</small></div>
            <div><span>Price lock</span><b>{order.price_locked_until ? new Date(order.price_locked_until).toLocaleString() : "Not recorded"}</b><small>Server-calculated snapshot</small></div>
          </div>
          <section className="order-detail-lines"><h3>Order items</h3>{(order.order_items || []).map((item) => <div key={item.id}><span><b>{item.quantity} × {item.product_name}</b><small>{item.sku} • {item.metal_weight_oz} oz {item.metal}</small></span><strong>{money(item.line_total)}</strong></div>)}</section>
          {order.customer_notes && <section className="order-customer-note"><h3>Customer note</h3><p>{order.customer_notes}</p></section>}
          <section className="order-customer-note"><h3>Payment contract</h3><p>Reference: {order.payment_reference || "Not recorded"}<br />Terms: {order.terms_version || "Legacy order"} • accepted {order.terms_accepted_at ? new Date(order.terms_accepted_at).toLocaleString() : "not recorded"}<br />Provider payment: {order.provider_payment_id || "Not created"}</p></section>

        </div>
        {error && <div className="form-message error" role="alert">{error}</div>}
        {blocked && <div className="form-message error" role="alert">{blocked}</div>}
        <footer><button type="button" className="button button-outline" onClick={onClose} disabled={saving}>Close</button><button className="button button-gold" disabled={saving || !changed || Boolean(blocked)}>{saving ? "Saving securely…" : "Save audited changes"}</button></footer>
      </form>
    </div>
  );
}
