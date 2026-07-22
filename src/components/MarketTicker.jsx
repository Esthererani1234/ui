import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { money } from "../lib/pricing";
import { fetchMarketPrices, readCachedMarket } from "../lib/marketPrices";

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
        const next = await fetchMarketPrices();
        if (mounted) {
          setData(next);
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
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 10_000);
    const refreshWhenVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
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
