import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  DollarSign,
  Download,
  MousePointer2,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { money, orderStatusLabel } from "../../lib/pricing";

const RANGE_OPTIONS = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
  { value: "0", label: "All" },
];

const METRICS = {
  gross_sales: { label: "Booked sales", short: "Sales", format: money },
  orders: { label: "Orders", short: "Orders", format: (value) => Math.round(value).toLocaleString() },
  average_order: { label: "Average order value", short: "Avg. order", format: money },
  units: { label: "Units ordered", short: "Units", format: (value) => Math.round(value).toLocaleString() },
};

const METAL_COLORS = {
  gold: "#d9ab47",
  silver: "#8fa3af",
  platinum: "#4f7288",
  palladium: "#294c64",
  other: "#b9c4cb",
};

const invokeAdmin = async (body) => {
  const { data, error } = await supabase.functions.invoke("admin-operations", {
    body,
  });
  if (error || data?.error)
    throw new Error(data?.error || error?.message || "Sales service could not be reached");
  return data;
};

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatBucketDate = (value, granularity = "day") => {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: granularity === "month" ? undefined : "numeric",
    year: granularity === "month" ? "2-digit" : undefined,
  }).format(date);
};

const changeFor = (current, previous, comparisonAvailable) => {
  if (!comparisonAvailable) return { label: "All-time total", tone: "neutral" };
  if (!previous && !current) return { label: "No change", tone: "neutral" };
  if (!previous) return { label: "New this period", tone: "up" };
  const percent = ((current - previous) / previous) * 100;
  return {
    label: `${Math.abs(percent).toFixed(Math.abs(percent) >= 10 ? 0 : 1)}% vs previous`,
    tone: percent > 0 ? "up" : percent < 0 ? "down" : "neutral",
  };
};

function Trend({ current, previous, comparisonAvailable }) {
  const change = changeFor(current, previous, comparisonAvailable);
  return (
    <small className={`sales-kpi-trend ${change.tone}`}>
      {change.tone === "up" && <ArrowUpRight />}
      {change.tone === "down" && <ArrowDownRight />}
      {change.label}
    </small>
  );
}

function SalesKpis({ report, metric, onMetric }) {
  const cards = [
    { key: "gross_sales", label: "Booked order value", value: report?.gross_sales || 0, previous: report?.previous?.gross_sales || 0, icon: DollarSign, format: money },
    { key: "orders", label: "Orders", value: report?.order_count || 0, previous: report?.previous?.order_count || 0, icon: ShoppingBag, format: (value) => value.toLocaleString() },
    { key: "average_order", label: "Average order", value: report?.average_order || 0, previous: report?.previous?.average_order || 0, icon: BarChart3, format: money },
    { key: "units", label: "Units ordered", value: report?.units || 0, previous: report?.previous?.units || 0, icon: PackageCheck, format: (value) => value.toLocaleString() },
  ];

  return (
    <div className="seller-kpi-grid">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <button
            type="button"
            key={card.key}
            className={`sales-kpi-card ${metric === card.key ? "active" : ""}`}
            onClick={() => onMetric(card.key)}
            aria-pressed={metric === card.key}
          >
            <span className="sales-kpi-heading"><Icon />{card.label}</span>
            <strong>{card.format(card.value)}</strong>
            <Trend
              current={card.value}
              previous={card.previous}
              comparisonAvailable={report?.comparison_available}
            />
          </button>
        );
      })}
    </div>
  );
}

function InteractiveSalesChart({ report, metric, compare }) {
  const svgRef = useRef(null);
  const series = report?.time_series || [];
  const comparison = report?.comparison_series || [];
  const [activeIndex, setActiveIndex] = useState(null);
  const width = 960;
  const height = 340;
  const margin = { top: 30, right: 28, bottom: 48, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const metricConfig = METRICS[metric];

  useEffect(() => {
    setActiveIndex(null);
  }, [series.length, metric]);

  const chart = useMemo(() => {
    const currentValues = series.map((point) => Number(point[metric] || 0));
    const previousValues = compare
      ? comparison.map((point) => Number(point[metric] || 0))
      : [];
    const yMax = Math.max(1, ...currentValues, ...previousValues);
    const xFor = (index, length = series.length) =>
      margin.left + (length <= 1 ? plotWidth / 2 : (index / (length - 1)) * plotWidth);
    const yFor = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;
    const line = (values) =>
      values.map((value, index) => `${index ? "L" : "M"}${xFor(index, values.length).toFixed(2)},${yFor(value).toFixed(2)}`).join(" ");
    const currentPath = line(currentValues);
    const previousPath = line(previousValues);
    const areaPath = currentValues.length
      ? `${currentPath} L${xFor(currentValues.length - 1, currentValues.length)},${margin.top + plotHeight} L${xFor(0, currentValues.length)},${margin.top + plotHeight} Z`
      : "";
    return { currentValues, previousValues, yMax, xFor, yFor, currentPath, previousPath, areaPath };
  }, [series, comparison, metric, compare, margin.left, margin.top, plotWidth, plotHeight]);

  const setPointerIndex = (clientX) => {
    if (!svgRef.current || !series.length) return;
    const box = svgRef.current.getBoundingClientRect();
    const viewX = ((clientX - box.left) / box.width) * width;
    const ratio = Math.max(0, Math.min(1, (viewX - margin.left) / plotWidth));
    setActiveIndex(Math.round(ratio * Math.max(series.length - 1, 0)));
  };

  const active = activeIndex === null ? null : series[activeIndex];
  const previousActive = activeIndex === null ? null : comparison[activeIndex];
  const activeX = activeIndex === null ? margin.left : chart.xFor(activeIndex);
  const activeY = active ? chart.yFor(Number(active[metric] || 0)) : margin.top + plotHeight;
  const tickIndexes = [...new Set([0, Math.floor((series.length - 1) * 0.25), Math.floor((series.length - 1) * 0.5), Math.floor((series.length - 1) * 0.75), Math.max(series.length - 1, 0)])].filter((index) => series[index]);
  const hasActivity = chart.currentValues.some((value) => value > 0);

  return (
    <section className="seller-chart-card">
      <header className="seller-chart-heading">
        <div>
          <small>PERFORMANCE TREND</small>
          <h3>{metricConfig.label}</h3>
          <p><MousePointer2 /> Hover or drag across the line to inspect exact values.</p>
        </div>
        <div className="seller-chart-legend">
          <span><i className="current" />Current period</span>
          {compare && report?.comparison_available && <span><i className="previous" />Previous period</span>}
        </div>
      </header>
      <div className="seller-chart-stage">
        <svg
          ref={svgRef}
          className="seller-line-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${metricConfig.label} over the selected period`}
          onPointerMove={(event) => setPointerIndex(event.clientX)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setPointerIndex(event.clientX);
          }}
        >
          <defs>
            <linearGradient id="sales-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d9ab47" stopOpacity=".34" />
              <stop offset="100%" stopColor="#d9ab47" stopOpacity=".02" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = margin.top + plotHeight * tick;
            const value = chart.yMax * (1 - tick);
            return (
              <g key={tick}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="sales-grid-line" />
                <text x={margin.left - 13} y={y + 4} textAnchor="end" className="sales-axis-label">
                  {metric === "gross_sales" || metric === "average_order" ? compactMoney.format(value) : Math.round(value).toLocaleString()}
                </text>
              </g>
            );
          })}
          {chart.areaPath && <path d={chart.areaPath} className="sales-area" />}
          {compare && chart.previousPath && <path d={chart.previousPath} className="sales-line previous" />}
          {chart.currentPath && <path d={chart.currentPath} className="sales-line current" />}
          {active && (
            <g className="sales-active-point">
              <line x1={activeX} x2={activeX} y1={margin.top} y2={margin.top + plotHeight} />
              <circle cx={activeX} cy={activeY} r="7" />
              <circle cx={activeX} cy={activeY} r="3" />
            </g>
          )}
          {tickIndexes.map((index) => (
            <text key={series[index].date} x={chart.xFor(index)} y={height - 17} textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"} className="sales-axis-label x">
              {formatBucketDate(series[index].date, report?.period?.granularity)}
            </text>
          ))}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotWidth}
            height={plotHeight}
            className="sales-chart-hitbox"
          />
        </svg>
        {active && (
          <div
            className={`sales-chart-tooltip ${activeIndex > series.length * 0.72 ? "align-right" : ""}`}
            style={{ left: `${(activeX / width) * 100}%`, top: `${Math.max(10, (activeY / height) * 100 - 4)}%` }}
            aria-live="polite"
          >
            <b>{formatBucketDate(active.date, report?.period?.granularity)}</b>
            <span><i className="current" />Current <strong>{metricConfig.format(Number(active[metric] || 0))}</strong></span>
            {compare && previousActive && <span><i className="previous" />Previous <strong>{metricConfig.format(Number(previousActive[metric] || 0))}</strong></span>}
          </div>
        )}
        {!hasActivity && <div className="sales-chart-empty"><BarChart3 /><b>No booked sales in this period</b><span>The chart will populate automatically after the first order.</span></div>}
      </div>
    </section>
  );
}

function ProgressRows({ entries, formatter = (value) => value.toLocaleString(), empty }) {
  const max = Math.max(1, ...entries.map(([, value]) => Number(value || 0)));
  if (!entries.length) return <p className="seller-empty-copy">{empty}</p>;
  return (
    <div className="seller-progress-list">
      {entries.map(([label, value]) => (
        <div key={label} className="seller-progress-row">
          <span><b>{orderStatusLabel(label)}</b><strong>{formatter(Number(value || 0))}</strong></span>
          <i><em style={{ width: `${(Number(value || 0) / max) * 100}%` }} /></i>
        </div>
      ))}
    </div>
  );
}

function SalesBreakdowns({ report }) {
  const products = report?.top_products || [];
  const metals = report?.metals || [];
  const metalTotal = metals.reduce((sum, item) => sum + Number(item.sales || 0), 0);
  let cumulative = 0;
  const gradient = metals.length
    ? metals.map((item) => {
        const start = cumulative;
        cumulative += metalTotal ? (Number(item.sales || 0) / metalTotal) * 100 : 0;
        return `${METAL_COLORS[item.metal] || METAL_COLORS.other} ${start}% ${cumulative}%`;
      }).join(", ")
    : "#e5eaed 0 100%";

  return (
    <div className="seller-breakdown-grid">
      <section className="seller-detail-card products">
        <header><div><small>CATALOG PERFORMANCE</small><h3>Top products</h3></div><span>Ranked by booked sales</span></header>
        {products.length ? (
          <div className="seller-product-table-wrap">
            <table className="seller-product-table">
              <thead><tr><th>#</th><th>Product</th><th>Units</th><th>Share</th><th>Sales</th></tr></thead>
              <tbody>{products.map((item, index) => (
                <tr key={item.name}>
                  <td>{index + 1}</td>
                  <td><b>{item.name}</b></td>
                  <td>{item.units.toLocaleString()}</td>
                  <td>{report?.gross_sales ? `${((item.sales / report.gross_sales) * 100).toFixed(1)}%` : "0%"}</td>
                  <td><strong>{money(item.sales)}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="seller-empty-copy">No product sales in this period.</p>}
      </section>

      <section className="seller-detail-card metal-mix">
        <header><div><small>MERCHANDISE MIX</small><h3>Sales by metal</h3></div></header>
        {metals.length ? <div className="metal-mix-layout">
          <div className="sales-donut" style={{ background: `conic-gradient(${gradient})` }}><span><b>{money(metalTotal)}</b><small>Total</small></span></div>
          <div className="metal-legend">{metals.map((item) => <div key={item.metal}><i style={{ background: METAL_COLORS[item.metal] || METAL_COLORS.other }} /><span><b>{item.metal}</b><small>{item.units} units</small></span><strong>{metalTotal ? `${((item.sales / metalTotal) * 100).toFixed(1)}%` : "0%"}</strong></div>)}</div>
        </div> : <p className="seller-empty-copy">No metal sales in this period.</p>}
      </section>

      <section className="seller-detail-card">
        <header><div><small>FULFILLMENT PIPELINE</small><h3>Order status</h3></div></header>
        <ProgressRows entries={Object.entries(report?.statuses || {}).sort((a, b) => b[1] - a[1])} empty="No order status data yet." />
      </section>

      <section className="seller-detail-card">
        <header><div><small>PAYMENT MIX</small><h3>Payment method</h3></div></header>
        <ProgressRows entries={Object.entries(report?.payments || {}).sort((a, b) => b[1] - a[1])} empty="No payment method data yet." />
      </section>
    </div>
  );
}

const exportReport = (report) => {
  const rows = [
    ["Date", "Booked sales", "Orders", "Units", "Average order"],
    ...(report?.time_series || []).map((point) => [
      point.date,
      point.gross_sales,
      point.orders,
      point.units,
      point.average_order,
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `goldonthespot-sales-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function SalesAnalyticsPanel() {
  const [days, setDays] = useState("30");
  const [metric, setMetric] = useState("gross_sales");
  const [compare, setCompare] = useState(true);
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const data = await invokeAdmin({ action: "sales_report", days: Number(days) });
      setReport(data.report);
      setUpdatedAt(new Date());
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [days]);
  useEffect(() => { if (days === "0") setCompare(false); }, [days]);

  return (
    <div className="enterprise-admin-stack seller-central-dashboard">
      <section className="admin-panel seller-analytics-panel">
        <div className="seller-analytics-title">
          <div><small>BUSINESS REPORTS</small><h2>Sales analytics</h2><p>Booked, non-cancelled orders with secure, live reporting from your store database.</p></div>
          <div className="seller-analytics-actions">
            <button type="button" className="button button-outline" onClick={() => exportReport(report)} disabled={!report}><Download /> Export CSV</button>
            <button type="button" className="button button-dark" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button>
          </div>
        </div>

        <div className="seller-control-bar">
          <div className="seller-range-switch" aria-label="Sales report period">
            {RANGE_OPTIONS.map((option) => <button type="button" key={option.value} className={days === option.value ? "active" : ""} onClick={() => setDays(option.value)}>{option.label}</button>)}
          </div>
          <label className="seller-compare-control"><input type="checkbox" checked={compare} disabled={!report?.comparison_available} onChange={(event) => setCompare(event.target.checked)} /> Compare previous period</label>
          <span className="seller-updated">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for report"}</span>
        </div>

        {message && <div className="form-message error seller-report-error"><b>Sales report unavailable</b><span>{message}</span><button type="button" onClick={load}>Try again</button></div>}
        {loading && !report ? <div className="catalog-loading">Building secure sales analytics…</div> : report && <>
          <SalesKpis report={report} metric={metric} onMetric={setMetric} />
          <InteractiveSalesChart report={report} metric={metric} compare={compare} />
          <SalesBreakdowns report={report} />
        </>}
      </section>
    </div>
  );
}
