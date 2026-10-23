import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { money } from "../lib/pricing";
import { fetchMarketPrices, readCachedMarket } from "../lib/marketPrices";
import '../styles/marketTimestamp.css';

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
  const updated = data?.timestamp ? new Date(data.timestamp) : null;
  const validUpdated = updated && Number.isFinite(updated.getTime());

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
      </div>
      <div className="container market-update">
        <span className={error ? 'market-status error' : 'market-status'}><Activity size={12} />{error ? (data ? 'Last price shown' : 'Retrying feed') : refreshing ? 'Refreshing market' : 'Live market'}</span>
        {validUpdated && <time dateTime={updated.toISOString()} title={updated.toLocaleString('en-US', { timeZone:'America/New_York', dateStyle:'medium', timeStyle:'long' })}>Updated {updated.toLocaleDateString('en-US', { timeZone:'America/New_York', month:'short', day:'numeric', year:'numeric' })} · {updated.toLocaleTimeString('en-US', { timeZone:'America/New_York', hour:'numeric', minute:'2-digit', hour12:true, timeZoneName:'short' })}</time>}
      </div>
    </section>
  );
}
