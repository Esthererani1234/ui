import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { supabase } from "../lib/supabase";
import { productPrice } from "../lib/pricing";
import MarketTicker from "../components/MarketTicker";
import ProductCard from "../components/ProductCard";

const PAGE_SIZE = 24;

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spot, setSpot] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const receivePrices = useCallback((next) => setSpot(next), []);
  const metal = params.get("metal") || "all";
  const category = params.get("category") || "all";
  const query = params.get("q") || "";
  const featured = params.get("featured") === "true";
  const sort = params.get("sort") || "recommended";

  useEffect(() => {
    setLoading(true);
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [metal, category, query, featured, sort]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = products.filter((product) => {
      if (metal !== "all" && product.metal !== metal) return false;
      if (category !== "all" && product.category !== category) return false;
      if (featured && !product.is_featured) return false;
      if (
        normalizedQuery &&
        !`${product.name} ${product.short_description || ""} ${
          product.description || ""
        } ${product.sku}`
          .toLowerCase()
          .includes(normalizedQuery)
      )
        return false;
      return true;
    });

    return [...matches].sort((a, b) => {
      if (sort === "price-low")
        return (productPrice(a, spot) ?? Infinity) -
          (productPrice(b, spot) ?? Infinity);
      if (sort === "price-high")
        return (productPrice(b, spot) ?? -Infinity) -
          (productPrice(a, spot) ?? -Infinity);
      if (sort === "name") return a.name.localeCompare(b.name);
      return (
        Number(b.is_featured) - Number(a.is_featured) ||
        Number(a.sort_order) - Number(b.sort_order)
      );
    });
  }, [products, metal, category, query, featured, sort, spot]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === "all" || !value || value === "recommended") next.delete(key);
    else next.set(key, value);
    setParams(next);
  };

  const hasFilters =
    metal !== "all" || category !== "all" || featured || Boolean(query);
  const visibleProducts = filtered.slice(0, visibleCount);

  return (
    <>
      <div className="page-only-ticker">
        <MarketTicker onPrices={receivePrices} />
      </div>
      <section className="shop-hero">
        <div className="container">
          <span className="eyebrow">LIVE-PRICED BULLION</span>
          <h1>Shop precious metals</h1>
          <p>
            Investment-grade products with current inventory and live market
            pricing.
          </p>
        </div>
      </section>
      <section className="section shop-section">
        <div className="container">
          <div className="mobile-shop-controls">
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal /> Filters
              {hasFilters && <b>Active</b>}
              <ChevronDown className={filtersOpen ? "open" : ""} />
            </button>
          </div>
          <div className="shop-layout">
            <aside className={`filters${filtersOpen ? " open" : ""}`}>
              <h3>
                <SlidersHorizontal size={18} /> Filters
              </h3>
              <label>
                Metal
                <select
                  value={metal}
                  onChange={(event) => setFilter("metal", event.target.value)}
                >
                  <option value="all">All metals</option>
                  <option value="gold">Gold</option>
                  <option value="silver">Silver</option>
                  <option value="platinum">Platinum</option>
                  <option value="palladium">Palladium</option>
                </select>
              </label>
              <label>
                Product type
                <select
                  value={category}
                  onChange={(event) =>
                    setFilter("category", event.target.value)
                  }
                >
                  <option value="all">All types</option>
                  <option value="coin">Coins</option>
                  <option value="bar">Bars</option>
                  <option value="round">Rounds</option>
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(event) =>
                    setFilter("featured", event.target.checked ? "true" : "")
                  }
                />
                Best sellers only
              </label>
              {hasFilters && (
                <button
                  className="text-button"
                  onClick={() => setParams(sort === "recommended" ? {} : { sort })}
                >
                  Clear filters
                </button>
              )}
            </aside>
            <div className="shop-results">
              <div className="results-bar">
                <div>
                  <b>{loading ? "Loading" : filtered.length} products</b>
                  {query && <span> matching “{query}”</span>}
                </div>
                <label className="catalog-sort">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setFilter("sort", event.target.value)}
                  >
                    <option value="recommended">Recommended</option>
                    <option value="price-low">Price: low to high</option>
                    <option value="price-high">Price: high to low</option>
                    <option value="name">Name</option>
                  </select>
                </label>
              </div>
              {loading ? (
                <div className="catalog-loading">Loading secure catalog…</div>
              ) : filtered.length ? (
                <>
                  <div className="product-grid three">
                    {visibleProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        spot={spot}
                      />
                    ))}
                  </div>
                  {visibleCount < filtered.length && (
                    <button
                      className="button button-outline catalog-load-more"
                      onClick={() =>
                        setVisibleCount((count) => count + PAGE_SIZE)
                      }
                    >
                      Show more products
                    </button>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <h2>No products found</h2>
                  <p>Try removing a filter or search term.</p>
                  <button
                    className="button button-dark"
                    onClick={() => setParams({})}
                  >
                    View all bullion
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
