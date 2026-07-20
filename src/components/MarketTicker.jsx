import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { money } from "../lib/pricing";

const CACHE_KEY = "gots-market-prices-v1";
const CACHE_MAX_AGE = 30 * 60 * 1000;

const readCachedMarket = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (
      cached?.metals &&
      Number(cached.cachedAt) > Date.now() - CACHE_MAX_AGE
    ) return cached;
  } catch {
    // A missing or invalid cache simply falls through to the live request.
  }
  return null;
};

const labels = [
  ["gold", "GOLD", "Au"],
  ["silver", "SILVER", "Ag"],
  ["platinum", "PLATINUM", "Pt"],
  ["palladium", "PALLADIUM", "Pd"],
];

export default function MarketTicker({ onPrices }) {
  const [data, setData] = useState(readCachedMarket);
  const [refreshing, setRefreshing] = useState(Boolean(data));
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (data?.metals) onPrices?.(data.metals);
    const load = async () => {
      try {
        const response = await fetch("/api/metals");
        const next = await response.json();
        if (!response.ok || !next.metals) throw new Error("Price feed unavailable");
        if (mounted) {
          const fresh = { ...next, cachedAt: Date.now() };
          setData(fresh);
          localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
          setRefreshing(false);
          setError(false);
          onPrices?.(next.metals);
        }
      } catch {
        if (mounted) {
          setRefreshing(false);
          setError(true);
        }
      }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [onPrices]);

  return (
    <section className="market-ticker" aria-label="Live precious metals prices">
      <div className="container ticker-grid">
        {labels.map(([key, label, symbol]) => (
          <div className="ticker-item" key={key}>
            <span className={`ticker-symbol ${key}`}>{symbol}</span>
            <span><b>{label}</b><small>USD / TROY OZ</small></span>
            <strong>{data ? money(data.metals[key]) : error ? "Unavailable" : "Loading…"}</strong>
          </div>
        ))}
        <div className={error ? "ticker-live error" : "ticker-live"}><Activity size={15} /><span>{error ? (data ? "Last price shown" : "Retrying feed") : refreshing ? "Refreshing market" : "Live market"}</span></div>
      </div>
    </section>
  );
}
