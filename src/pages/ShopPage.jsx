import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { supabase } from "../lib/supabase";
import MarketTicker from "../components/MarketTicker";
import ProductCard from "../components/ProductCard";

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spot, setSpot] = useState(null);
  const receivePrices = useCallback((next) => setSpot(next), []);
  const metal = params.get("metal") || "all";
  const category = params.get("category") || "all";
  const query = params.get("q") || "";
  const featured = params.get("featured") === "true";

  useEffect(() => {
    setLoading(true);
    supabase.from("products").select("*").eq("is_active", true).order("sort_order").then(({ data }) => {
      setProducts(data || []);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => products.filter((product) => {
    if (metal !== "all" && product.metal !== metal) return false;
    if (category !== "all" && product.category !== category) return false;
    if (featured && !product.is_featured) return false;
    if (query && !`${product.name} ${product.description} ${product.sku}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [products, metal, category, query, featured]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === "all" || !value) next.delete(key); else next.set(key, value);
    setParams(next);
  };

  return (
    <>
      <div className="page-only-ticker"><MarketTicker onPrices={receivePrices} /></div>
      <section className="shop-hero"><div className="container"><span className="eyebrow">LIVE-PRICED BULLION</span><h1>Shop precious metals</h1><p>Investment-grade products with inventory, premiums, and pricing shown clearly.</p></div></section>
      <section className="section shop-section">
        <div className="container shop-layout">
          <aside className="filters">
            <h3><SlidersHorizontal size={18} /> Filters</h3>
            <label>Metal<select value={metal} onChange={(event) => setFilter("metal", event.target.value)}><option value="all">All metals</option><option value="gold">Gold</option><option value="silver">Silver</option><option value="platinum">Platinum</option><option value="palladium">Palladium</option></select></label>
            <label>Product type<select value={category} onChange={(event) => setFilter("category", event.target.value)}><option value="all">All types</option><option value="coin">Coins</option><option value="bar">Bars</option><option value="round">Rounds</option></select></label>
            <label className="check-row"><input type="checkbox" checked={featured} onChange={(event) => setFilter("featured", event.target.checked ? "true" : "")} /> Best sellers only</label>
            {(metal !== "all" || category !== "all" || featured || query) && <button className="text-button" onClick={() => setParams({})}>Clear filters</button>}
          </aside>
          <div className="shop-results">
            <div className="results-bar"><div><b>{loading ? "Loading" : filtered.length} products</b>{query && <span> matching “{query}”</span>}</div><span>Prices refresh with spot</span></div>
            {loading ? <div className="catalog-loading">Loading secure catalog…</div> : filtered.length ? <div className="product-grid three">{filtered.map((product) => <ProductCard key={product.id} product={product} spot={spot} />)}</div> : <div className="empty-state"><h2>No products found</h2><p>Try removing a filter or search term.</p><button className="button button-dark" onClick={() => setParams({})}>View all bullion</button></div>}
          </div>
        </div>
      </section>
    </>
  );
}
