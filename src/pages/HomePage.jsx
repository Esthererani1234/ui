import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  Headphones,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { metalSymbol, money, productPrice } from "../lib/pricing";
import MarketTicker from "../components/MarketTicker";
import ProductCard from "../components/ProductCard";

const metals = [
  { key: "gold", name: "Gold", symbol: "Au", note: "Store of value" },
  { key: "silver", name: "Silver", symbol: "Ag", note: "Accessible bullion" },
  { key: "platinum", name: "Platinum", symbol: "Pt", note: "Rare & industrial" },
  { key: "palladium", name: "Palladium", symbol: "Pd", note: "Specialty metal" },
];

const shopPaths = [
  { label: "Gold coins", detail: "Buffaloes, Eagles and sovereign-minted gold", to: "/shop?metal=gold&category=coin", metal: "gold", category: "coin", symbol: "Au", art: "coin" },
  { label: "Gold bars", detail: "Investment bars in practical weights", to: "/shop?metal=gold&category=bar", metal: "gold", category: "bar", symbol: "Au", art: "bar" },
  { label: "Silver coins", detail: "Government-minted silver bullion", to: "/shop?metal=silver&category=coin", metal: "silver", category: "coin", symbol: "Ag", art: "coin" },
  { label: "Silver bars", detail: "Stackable silver bars and larger formats", to: "/shop?metal=silver&category=bar", metal: "silver", category: "bar", symbol: "Ag", art: "bar" },
];

function FeaturedHeroProduct({ product, spot }) {
  const price = productPrice(product, spot);
  const image = product?.image_url || product?.image_urls?.[0];

  if (!product) {
    return (
      <div className="home-hero-product placeholder" aria-hidden="true">
        <div className="home-hero-bullion"><span>G</span><b>FINE BULLION</b><small>GOLDONTHESPOT</small></div>
      </div>
    );
  }

  return (
    <Link className="home-hero-product" to={`/product/${product.slug}`}>
      <div className="home-hero-product-topline">
        <span><Sparkles /> Featured at the bullion desk</span>
        {product.badge && <b>{product.badge}</b>}
      </div>
      <div className="home-hero-product-image">
        {image ? <img src={image} alt={product.name} /> : (
          <div className={`home-hero-bullion ${product.metal}`}>
            <span>{metalSymbol(product.metal)}</span>
            <b>{product.metal_weight_oz} TROY OZ</b>
            <small>FINE {product.metal}</small>
          </div>
        )}
      </div>
      <div className="home-hero-product-info">
        <span>{product.metal} · {product.category}</span>
        <h2>{product.name}</h2>
        <div>
          <p><small>Current price</small><strong>{price == null ? "Request quote" : money(price)}</strong></p>
          <em>{product.inventory_count > 0 ? "Available now" : "Currently unavailable"}</em>
        </div>
      </div>
    </Link>
  );
}

function MarketDesk({ spot }) {
  return (
    <section className="home-market-desk">
      <div className="container">
        <div className="home-market-heading">
          <div>
            <span className="eyebrow dark">LIVE MARKET DESK</span>
            <h2>Know the market before you buy.</h2>
            <p>GoldOnTheSpot prices refresh automatically. Compare the current ounce and gram basis at a glance.</p>
          </div>
          <span className="home-market-status"><i /> Refreshes every 30 seconds</span>
        </div>
        <div className="home-market-grid">
          {metals.map((metal) => {
            const ounce = Number(spot?.[metal.key]);
            return (
              <Link key={metal.key} className={`home-market-card ${metal.key}`} to={`/shop?metal=${metal.key}`}>
                <span className="home-market-symbol">{metal.symbol}</span>
                <span className="home-market-name"><b>{metal.name}</b><small>{metal.note}</small></span>
                <span className="home-market-price">
                  <small>Per troy ounce</small>
                  <strong>{ounce > 0 ? money(ounce) : "Loading…"}</strong>
                  <em>{ounce > 0 ? `${money(ounce / 31.1034768)} / gram` : "Live feed"}</em>
                </span>
                <ArrowRight />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [spot, setSpot] = useState(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const receivePrices = useCallback((next) => setSpot(next), []);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("is_featured", { ascending: false })
      .order("sort_order")
      .limit(8)
      .then(({ data }) => {
        if (!mounted) return;
        setProducts(data || []);
        setLoadingProducts(false);
      });
    return () => { mounted = false; };
  }, []);

  const heroProduct = useMemo(
    () => products.find((product) => product.is_featured) || products[0] || null,
    [products],
  );
  const categoryImage = (path) => {
    const product = products.find((item) => item.metal === path.metal && item.category === path.category && (item.image_url || item.image_urls?.[0]));
    return product?.image_url || product?.image_urls?.[0] || "";
  };

  return (
    <>
      <div className="page-only-ticker"><MarketTicker onPrices={receivePrices} /></div>

      <section className="home-hero">
        <div className="home-hero-glow one" />
        <div className="home-hero-glow two" />
        <div className="container home-hero-grid">
          <div className="home-hero-copy">
            <span className="eyebrow">PRECIOUS METALS · PRICED RIGHT NOW</span>
            <h1>A clearer way to<br /><em>own real value.</em></h1>
            <p>Shop physical gold, silver, platinum and palladium with live market-linked pricing, tracked inventory and secure order review.</p>
            <div className="home-hero-actions">
              <Link className="button button-gold large" to="/shop">Shop all bullion <ArrowRight /></Link>
              <Link className="button home-hero-secondary large" to="/shop?metal=gold">Explore gold</Link>
            </div>
            <div className="home-hero-confidence">
              <span><BadgeCheck /> Authenticity focused</span>
              <span><ShieldCheck /> Insured fulfillment</span>
              <span><Clock3 /> Server-locked pricing</span>
            </div>
          </div>
          <FeaturedHeroProduct product={heroProduct} spot={spot} />
        </div>
      </section>

      <section className="home-service-strip" aria-label="Store benefits">
        <div className="container home-service-grid">
          <div><LockKeyhole /><span><b>Secure ordering</b><small>Protected customer accounts</small></span></div>
          <div><PackageCheck /><span><b>Real inventory</b><small>Availability checked at checkout</small></span></div>
          <div><Truck /><span><b>Insured shipping</b><small>Signature-required delivery</small></span></div>
          <div><Headphones /><span><b>Human support</b><small>Help before and after ordering</small></span></div>
        </div>
      </section>

      <section className="section home-products-section home-products-priority">
        <div className="container">
          <div className="home-section-heading">
            <div><span className="eyebrow dark">SHOP AVAILABLE INVENTORY</span><h2>Bullion you can order now.</h2><p>Active listings with market-linked prices, clear weights, and current availability.</p></div>
            <Link to="/shop">View all products <ArrowRight /></Link>
          </div>
          {loadingProducts ? <div className="catalog-loading">Loading today’s bullion selection…</div> : products.length ? <div className="product-grid home-product-grid">{products.slice(0, 4).map((product) => <ProductCard key={product.id} product={product} spot={spot} />)}</div> : <div className="empty-state compact"><h3>Listings are being added</h3><p>There are no active products to display yet.</p></div>}
        </div>
      </section>

      <section className="section home-shop-section">
        <div className="container">
          <div className="home-section-heading">
            <div><span className="eyebrow dark">SHOP BY FORMAT</span><h2>Start with what you want to own.</h2><p>Choose coins or bars, then compare the real listings currently available.</p></div>
            <Link to="/shop">View full catalog <ArrowRight /></Link>
          </div>
          <div className="home-shop-grid">
            {shopPaths.map((path) => (
              <Link key={path.label} className={`home-shop-tile ${path.metal}`} to={path.to}>
                {categoryImage(path) ? <span className="home-tile-product"><img src={categoryImage(path)} alt="" /></span> : <span className={`home-tile-art ${path.art}`}>{path.symbol}</span>}
                <span><b>{path.label}</b><small>{path.detail}</small></span>
                <ArrowRight />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <MarketDesk spot={spot} />

      <section className="home-process-section">
        <div className="container">
          <div className="home-process-heading"><span className="eyebrow dark">A CLEAR ORDER PROCESS</span><h2>Know what happens next.</h2></div>
          <ol className="home-process-grid">
            <li><b>1</b><span><strong>Choose</strong><small>Compare metal, mint, weight and live selling price.</small></span></li>
            <li><b>2</b><span><strong>Lock</strong><small>Checkout rechecks inventory and confirms your exact total.</small></span></li>
            <li><b>3</b><span><strong>Pay</strong><small>Complete the approved payment method shown on the order.</small></span></li>
            <li><b>4</b><span><strong>Receive</strong><small>Track careful fulfillment and signature-required delivery.</small></span></li>
          </ol>
        </div>
      </section>

      <section className="home-help-section">
        <div className="container home-help-card">
          <div><Headphones /><span><small>PERSONAL BULLION SUPPORT</small><h2>Questions before a larger order?</h2><p>Ask about products, payment timing or insured fulfillment before you lock the price.</p></span></div>
          <div><Link className="button button-gold" to="/support">Visit support center</Link><a href="mailto:support@goldonthespot.com">support@goldonthespot.com</a></div>
        </div>
      </section>
    </>
  );
}
