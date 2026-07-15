import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { money } from "../lib/pricing";

const labels = [
  ["gold", "GOLD", "Au"],
  ["silver", "SILVER", "Ag"],
  ["platinum", "PLATINUM", "Pt"],
  ["palladium", "PALLADIUM", "Pd"],
];

export default function MarketTicker({ onPrices }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/metals?t=${Date.now()}`, { cache: "no-store" });
        const next = await response.json();
        if (!response.ok || !next.metals) throw new Error("Price feed unavailable");
        if (mounted) {
          setData(next);
          setError(false);
          onPrices?.(next.metals);
        }
      } catch {
        if (mounted) setError(true);
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
        <div className={error ? "ticker-live error" : "ticker-live"}><Activity size={15} /><span>{error ? "Retrying feed" : "Live market"}</span></div>
      </div>
    </section>
  );
}
