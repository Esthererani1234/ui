import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Headphones, LockKeyhole, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { supabase } from "../lib/supabase";
import MarketTicker from "../components/MarketTicker";
import ProductCard from "../components/ProductCard";

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [spot, setSpot] = useState(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const receivePrices = useCallback((next) => setSpot(next), []);

  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .eq("is_featured", true)
      .order("sort_order")
      .limit(4)
      .then(({ data }) => { setProducts(data || []); setLoadingProducts(false); });
  }, []);

  return (
    <>
      <div className="page-only-ticker"><MarketTicker onPrices={receivePrices} /></div>
      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">REAL METAL • TRANSPARENT PRICING</span>
            <h1>Own something<br /><em>that lasts.</em></h1>
            <p>Shop investment-grade gold, silver, platinum, and palladium. Prices move with the market and every order is reviewed for secure fulfillment.</p>
            <div className="hero-actions"><Link className="button button-gold" to="/shop?metal=gold">Shop gold</Link><Link className="button button-light" to="/shop">Browse all bullion</Link></div>
            <div className="hero-proof"><span><BadgeCheck size={18} /> Transparent premium</span><span><ShieldCheck size={18} /> Insured fulfillment</span></div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="coin-shadow"></div>
            <div className="hero-coin"><small>UNITED STATES OF AMERICA</small><strong>$50</strong><b>1 OZ .9999 FINE GOLD</b><span>AMERICAN BUFFALO</span></div>
            <div className="hero-bar"><b>GOTS</b><span>FINE GOLD 999.9</span><small>1 TROY OUNCE</small></div>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div className="container trust-grid">
          <div><LockKeyhole /><span><b>Secure ordering</b><small>Protected account checkout</small></span></div>
          <div><Truck /><span><b>Insured delivery</b><small>Signature required</small></span></div>
          <div><PackageCheck /><span><b>Inventory tracked</b><small>Availability confirmed</small></span></div>
          <div><Headphones /><span><b>Personal support</b><small>Help for every order size</small></span></div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading"><div><span className="eyebrow dark">SHOP BY METAL</span><h2>Build your holdings</h2><p>Choose the metal and format that fits your strategy.</p></div><Link to="/shop">View every product →</Link></div>
          <div className="metal-category-grid">
            <Link className="metal-category gold" to="/shop?metal=gold"><span>Au</span><div><small>WEALTH PRESERVATION</small><h3>Gold bullion</h3><p>Buffaloes, Eagles, sovereign coins, and bars.</p></div></Link>
            <Link className="metal-category silver" to="/shop?metal=silver"><span>Ag</span><div><small>ACCESSIBLE HARD ASSETS</small><h3>Silver bullion</h3><p>Sovereign coins, rounds, and stacker bars.</p></div></Link>
            <Link className="metal-category platinum" to="/shop?metal=platinum"><span>Pt</span><div><small>SCARCE INDUSTRIAL METAL</small><h3>Platinum</h3><p>Premium bars and investment coins.</p></div></Link>
          </div>
        </div>
      </section>

      <section className="section featured-section">
        <div className="container">
          <div className="section-heading"><div><span className="eyebrow dark">THE BULLION DESK</span><h2>Featured products</h2><p>Live prices calculated from spot plus the displayed product premium.</p></div><Link to="/shop?featured=true">See best sellers →</Link></div>
          {loadingProducts ? <div className="catalog-loading">Loading today’s bullion selection…</div> : products.length ? <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} spot={spot} />)}</div> : <div className="empty-state compact"><h3>Listings are being added</h3><p>Check back shortly for available bullion inventory.</p></div>}
        </div>
      </section>

      <section className="how-section">
        <div className="container how-grid">
          <div><span className="eyebrow">CLEAR FROM CART TO DELIVERY</span><h2>A better way to buy bullion.</h2><p>The market moves quickly. Our system recalculates pricing, locks the order total, verifies inventory, and gives you clear payment and fulfillment instructions.</p><Link className="button button-gold" to="/about">How GoldOnTheSpot works</Link></div>
          <ol><li><b>1</b><span><strong>Choose your metal</strong><small>Compare weights, mints, and premiums.</small></span></li><li><b>2</b><span><strong>Lock your order</strong><small>Your total is recalculated securely at checkout.</small></span></li><li><b>3</b><span><strong>Complete payment</strong><small>Use the approved method shown on your order.</small></span></li><li><b>4</b><span><strong>Track fulfillment</strong><small>Follow status from payment through delivery.</small></span></li></ol>
        </div>
      </section>
    </>
  );
}
