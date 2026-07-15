import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus, ShieldCheck, Trash2 } from "lucide-react";
import MarketTicker from "../components/MarketTicker";
import { money, productPrice } from "../lib/pricing";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";

export default function CartPage() {
  const { items, update, remove } = useCart();
  const { user } = useAuth();
  const [spot, setSpot] = useState(null);
  const receivePrices = useCallback((next) => setSpot(next), []);
  const subtotal = items.reduce((sum, item) => sum + (productPrice(item.product, spot) || 0) * item.quantity, 0);
  const shipping = subtotal >= 5000 ? 0 : 35;

  return (
    <>
      <div className="page-only-ticker"><MarketTicker onPrices={receivePrices} /></div>
      <section className="section cart-section"><div className="container narrow">
        <div className="section-heading"><div><span className="eyebrow dark">YOUR ORDER</span><h1>Shopping cart</h1></div><Link to="/shop">Continue shopping →</Link></div>
        {!items.length ? <div className="empty-state"><h2>Your cart is empty</h2><p>Explore live-priced coins and bars to begin your order.</p><Link className="button button-dark" to="/shop">Shop bullion</Link></div> : <div className="cart-layout">
          <div className="cart-items">{items.map(({ product, quantity }) => { const price = productPrice(product, spot); return <article className="cart-item" key={product.id}><div className={`cart-thumb ${product.metal}`}>{product.metal === "gold" ? "Au" : product.metal === "silver" ? "Ag" : "Pt"}</div><div className="cart-item-copy"><span className="product-kicker">{product.metal} • {product.category}</span><Link to={`/product/${product.slug}`}><h3>{product.name}</h3></Link><small>{price == null ? "Updating live price…" : `${money(price)} each`}</small></div><div className="quantity"><button onClick={() => update(product.id, quantity - 1)}><Minus size={15} /></button><span>{quantity}</span><button disabled={quantity >= product.inventory_count} onClick={() => update(product.id, quantity + 1)}><Plus size={15} /></button></div><strong className="line-total">{price == null ? "—" : money(price * quantity)}</strong><button className="icon-button" onClick={() => remove(product.id)} aria-label={`Remove ${product.name}`}><Trash2 size={18} /></button></article>; })}</div>
          <aside className="order-summary"><h2>Order summary</h2><div><span>Live-priced subtotal</span><b>{money(subtotal)}</b></div><div><span>Insured shipping</span><b>{shipping ? money(shipping) : "Free"}</b></div><div className="summary-total"><span>Estimated total</span><strong>{money(subtotal + shipping)}</strong></div><p><ShieldCheck size={16} /> Prices and inventory are securely rechecked when you place the order.</p><Link className={`button button-gold full ${!spot ? "disabled" : ""}`} to={spot ? (user ? "/checkout" : "/login?return=/checkout") : "#"}>{user ? "Secure checkout" : "Sign in to checkout"}</Link><small className="summary-note">Card invoice requests include a 4% processing surcharge. Wire, ACH, and check do not.</small></aside>
        </div>}
      </div></section>
    </>
  );
}
