import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus, ShieldCheck, Trash2 } from "lucide-react";
import MarketTicker from "../components/MarketTicker";
import { metalSymbol, money, productPrice } from "../lib/pricing";
import { supabase } from "../lib/supabase";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";

export default function CartPage() {
  const { items, update, remove, reconcileProducts } = useCart();
  const { user } = useAuth();
  const [spot, setSpot] = useState(null);
  const [settings, setSettings] = useState({ shipping_flat: 35, free_shipping_threshold: 5000, card_surcharge_percent: 4 });
  const [cartNotice, setCartNotice] = useState("");
  const receivePrices = useCallback((next) => setSpot(next), []);
  const itemIds = useMemo(() => items.map((item) => item.product.id).sort((a, b) => a - b).join(","), [items]);
  useEffect(() => {
    if (!itemIds) return;
    const ids = itemIds.split(",").map(Number);
    supabase.from("products").select("*").in("id", ids).then(({ data, error }) => {
      if (error) return setCartNotice("Current inventory could not be refreshed. Checkout will verify it securely.");
      const available = (data || []).filter((product) => product.is_active && product.inventory_count > 0);
      if (available.length < ids.length) setCartNotice("An unavailable product was removed from your cart.");
      reconcileProducts(data || []);
    });
  }, [itemIds]);
  useEffect(() => {
    supabase.from("app_settings").select("key, value").in("key", ["shipping_flat", "free_shipping_threshold", "card_surcharge_percent"]).then(({ data }) => {
      if (!data) return;
      setSettings((current) => data.reduce((next, row) => ({ ...next, [row.key]: Number(row.value) }), current));
    });
  }, []);
  const subtotal = items.reduce((sum, item) => sum + (productPrice(item.product, spot) || 0) * item.quantity, 0);
  const shipping = subtotal >= settings.free_shipping_threshold ? 0 : settings.shipping_flat;

  return (
    <>
      <div className="page-only-ticker"><MarketTicker onPrices={receivePrices} /></div>
      <section className="section cart-section"><div className="container narrow">
        <div className="section-heading"><div><span className="eyebrow dark">YOUR ORDER</span><h1>Shopping cart</h1></div><Link to="/shop">Continue shopping →</Link></div>
        {cartNotice && <div className="form-message">{cartNotice}</div>}
        {!items.length ? <div className="empty-state"><h2>Your cart is empty</h2><p>Explore live-priced coins and bars to begin your order.</p><Link className="button button-dark" to="/shop">Shop bullion</Link></div> : <div className="cart-layout">
          <div className="cart-items">{items.map(({ product, quantity }) => { const price = productPrice(product, spot); return <article className="cart-item" key={product.id}><div className={`cart-thumb ${product.metal}`}>{metalSymbol(product.metal)}</div><div className="cart-item-copy"><span className="product-kicker">{product.metal} • {product.category}</span><Link to={`/product/${product.slug}`}><h3>{product.name}</h3></Link><small>{price == null ? "Updating live price…" : `${money(price)} each`}</small></div><div className="quantity"><button type="button" onClick={() => update(product.id, quantity - 1)} aria-label={`Decrease ${product.name} quantity`}><Minus /></button><span>{quantity}</span><button type="button" disabled={quantity >= product.inventory_count} onClick={() => update(product.id, quantity + 1)} aria-label={`Increase ${product.name} quantity`}><Plus /></button></div><strong className="line-total">{price == null ? "—" : money(price * quantity)}</strong><button type="button" className="icon-button" onClick={() => remove(product.id)} aria-label={`Remove ${product.name}`}><Trash2 /></button></article>; })}</div>
          <aside className="order-summary"><h2>Order summary</h2><div><span>Live-priced subtotal</span><b>{spot ? money(subtotal) : "Loading…"}</b></div><div><span>Insured shipping</span><b>{shipping ? money(shipping) : "Free"}</b></div><div className="summary-total"><span>Estimated total</span><strong>{spot ? money(subtotal + shipping) : "—"}</strong></div><p><ShieldCheck /> Prices and inventory are securely rechecked when you place the order.</p>{spot ? <Link className="button button-gold full" to={user ? "/checkout" : "/login?return=/checkout"}>{user ? "Secure checkout" : "Sign in to checkout"}</Link> : <button className="button button-gold full" disabled>Loading live prices…</button>}<small className="summary-note">Card invoice requests include a {settings.card_surcharge_percent}% processing surcharge. Wire, ACH, and check do not.</small></aside>
        </div>}
      </div></section>
    </>
  );
}
