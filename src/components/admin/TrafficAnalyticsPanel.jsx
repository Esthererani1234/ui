import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Eye,
  MapPin,
  MousePointer2,
  RefreshCw,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import { supabase } from "../../lib/supabase";

const RANGES = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
];

const METRICS = {
  visitors: {
    label: "Unique visitors",
    short: "Visitors",
    icon: UserRound,
  },
  page_views: {
    label: "Page views",
    short: "Page views",
    icon: Eye,
  },
  product_views: {
    label: "Listing views",
    short: "Listing views",
    icon: Activity,
  },
  cart_adds: {
    label: "Cart additions",
    short: "Cart adds",
    icon: ShoppingCart,
  },
  orders: {
    label: "Orders",
    short: "Orders",
    icon: BarChart3,
  },
};

const number = (value) => Math.round(Number(value || 0)).toLocaleString();
const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
const formatDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));

const hourLabel = (hour) => {
  const normalized = Number(hour) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return `${normalized % 12} ${normalized < 12 ? "AM" : "PM"}`;
};

const trend = (current, previous) => {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!previousValue && !currentValue)
    return { label: "No activity yet", tone: "neutral" };
  if (!previousValue) return { label: "New this period", tone: "up" };
  const change = ((currentValue - previousValue) / previousValue) * 100;
  return {
    label: `${Math.abs(change).toFixed(Math.abs(change) >= 10 ? 0 : 1)}% vs prior`,
    tone: change > 0 ? "up" : change < 0 ? "down" : "neutral",
  };
};

function MetricCards({ report, metric, onMetric }) {
  return (
    <div className="seller-kpi-grid traffic-kpi-grid">
      {Object.entries(METRICS).map(([key, config]) => {
        const Icon = config.icon;
        const change = trend(
          report?.summary?.[key],
          report?.previous?.[key],
        );
        return (
          <button
            key={key}
            type="button"
            className={`sales-kpi-card ${metric === key ? "active" : ""}`}
            onClick={() => onMetric(key)}
            aria-pressed={metric === key}
          >
            <span className="sales-kpi-heading">
              <Icon />
              {config.label}
            </span>
            <strong>{number(report?.summary?.[key])}</strong>
            <small className={`sales-kpi-trend ${change.tone}`}>
              {change.tone === "up" && <ArrowUpRight />}
              {change.tone === "down" && <ArrowDownRight />}
              {change.label}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function TrafficChart({ report, metric }) {
  const svgRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(null);
  const series = report?.daily || [];
  const width = 960;
  const height = 340;
  const margin = { top: 30, right: 28, bottom: 48, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  useEffect(() => setActiveIndex(null), [metric, series.length]);

  const chart = useMemo(() => {
    const values = series.map((point) => Number(point[metric] || 0));
    const yMax = Math.max(1, ...values);
    const xFor = (index) =>
      margin.left +
      (values.length <= 1
        ? plotWidth / 2
        : (index / (values.length - 1)) * plotWidth);
    const yFor = (value) =>
      margin.top + plotHeight - (Number(value || 0) / yMax) * plotHeight;
    const line = values
      .map(
        (value, index) =>
          `${index ? "L" : "M"}${xFor(index).toFixed(2)},${yFor(value).toFixed(2)}`,
      )
      .join(" ");
    const area = values.length
      ? `${line} L${xFor(values.length - 1)},${margin.top + plotHeight} L${xFor(0)},${margin.top + plotHeight} Z`
      : "";
    return { values, yMax, xFor, yFor, line, area };
  }, [series, metric, margin.left, margin.top, plotHeight, plotWidth]);

  const pointFromPointer = (clientX) => {
    if (!svgRef.current || !series.length) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * width;
    const ratio = Math.max(
      0,
      Math.min(1, (x - margin.left) / plotWidth),
    );
    setActiveIndex(Math.round(ratio * Math.max(series.length - 1, 0)));
  };

  const active = activeIndex === null ? null : series[activeIndex];
  const activeX =
    activeIndex === null ? margin.left : chart.xFor(activeIndex);
  const activeY = active
    ? chart.yFor(active[metric])
    : margin.top + plotHeight;
  const tickIndexes = [
    ...new Set([
      0,
      Math.floor((series.length - 1) * 0.25),
      Math.floor((series.length - 1) * 0.5),
      Math.floor((series.length - 1) * 0.75),
      Math.max(series.length - 1, 0),
    ]),
  ].filter((index) => series[index]);
  const hasActivity = chart.values.some((value) => value > 0);

  return (
    <section className="seller-chart-card">
      <header className="seller-chart-heading">
        <div>
          <small>DAILY STOREFRONT TREND</small>
          <h3>{METRICS[metric].label}</h3>
          <p>
            <MousePointer2 /> Hover or drag across the line for exact numbers.
          </p>
        </div>
        <div className="seller-chart-legend">
          <span>
            <i className="current" />
            Eastern time
          </span>
        </div>
      </header>
      <div className="seller-chart-stage">
        <svg
          ref={svgRef}
          className="seller-line-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${METRICS[metric].label} by day`}
          onPointerMove={(event) => pointFromPointer(event.clientX)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            pointFromPointer(event.clientX);
          }}
        >
          <defs>
            <linearGradient id="traffic-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d9ab47" stopOpacity=".34" />
              <stop offset="100%" stopColor="#d9ab47" stopOpacity=".02" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = margin.top + plotHeight * tick;
            const value = chart.yMax * (1 - tick);
            return (
              <g key={tick}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y}
                  y2={y}
                  className="sales-grid-line"
                />
                <text
                  x={margin.left - 12}
                  y={y + 4}
                  textAnchor="end"
                  className="sales-axis-label"
                >
                  {number(value)}
                </text>
              </g>
            );
          })}
          {chart.area && (
            <path d={chart.area} className="traffic-chart-area" />
          )}
          {chart.line && (
            <path d={chart.line} className="sales-line current" />
          )}
          {active && (
            <g className="sales-active-point">
              <line
                x1={activeX}
                x2={activeX}
                y1={margin.top}
                y2={margin.top + plotHeight}
              />
              <circle cx={activeX} cy={activeY} r="7" />
              <circle cx={activeX} cy={activeY} r="3" />
            </g>
          )}
          {tickIndexes.map((index) => (
            <text
              key={series[index].date}
              x={chart.xFor(index)}
              y={height - 17}
              textAnchor={
                index === 0
                  ? "start"
                  : index === series.length - 1
                    ? "end"
                    : "middle"
              }
              className="sales-axis-label x"
            >
              {formatDate(series[index].date)}
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
            style={{
              left: `${(activeX / width) * 100}%`,
              top: `${Math.max(10, (activeY / height) * 100 - 4)}%`,
            }}
          >
            <b>{formatDate(active.date)}</b>
            <span>
              <i className="current" />
              {METRICS[metric].short}
              <strong>{number(active[metric])}</strong>
            </span>
          </div>
        )}
        {!hasActivity && (
          <div className="sales-chart-empty">
            <Activity />
            <b>Traffic collection has just started</b>
            <span>Real visitor data will populate this chart automatically.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function RatioCards({ summary }) {
  const cards = [
    {
      label: "Listing click rate",
      value: percent(summary?.listing_click_rate),
      detail: "listing clicks ÷ page views",
    },
    {
      label: "Product-to-cart rate",
      value: percent(summary?.product_to_cart_rate),
      detail: "cart adds ÷ listing views",
    },
    {
      label: "Visitor-to-order rate",
      value: percent(summary?.visitor_to_order_rate),
      detail: "orders ÷ unique visitors",
    },
    {
      label: "Pages per session",
      value: Number(summary?.pages_per_session || 0).toFixed(2),
      detail: "engagement depth",
    },
  ];
  return (
    <div className="traffic-ratio-grid">
      {cards.map((card) => (
        <article key={card.label}>
          <small>{card.label}</small>
          <strong>{card.value}</strong>
          <span>{card.detail}</span>
        </article>
      ))}
    </div>
  );
}

function ProgressList({ entries, labelFor, valueFor, empty }) {
  const max = Math.max(1, ...entries.map((item) => Number(valueFor(item) || 0)));
  if (!entries.length) return <p className="seller-empty-copy">{empty}</p>;
  return (
    <div className="seller-progress-list">
      {entries.map((item, index) => {
        const value = Number(valueFor(item) || 0);
        return (
          <div key={`${labelFor(item)}-${index}`} className="seller-progress-row">
            <span>
              <b>{labelFor(item)}</b>
              <strong>{number(value)}</strong>
            </span>
            <i>
              <em style={{ width: `${(value / max) * 100}%` }} />
            </i>
          </div>
        );
      })}
    </div>
  );
}

function TrafficBreakdowns({ report }) {
  const products = report?.products || [];
  const locations = report?.locations || [];
  const hours = report?.hours || [];
  const maxHour = Math.max(1, ...hours.map((item) => Number(item.visitors || 0)));
  const busiest = [...hours].sort(
    (a, b) => Number(b.visitors || 0) - Number(a.visitors || 0),
  )[0];

  return (
    <div className="seller-breakdown-grid traffic-breakdowns">
      <section className="seller-detail-card products">
        <header>
          <div>
            <small>LISTING PERFORMANCE</small>
            <h3>Views, clicks, carts, and sales by product</h3>
          </div>
          <span>Up to 100 listings</span>
        </header>
        {products.length ? (
          <div className="seller-product-table-wrap">
            <table className="seller-product-table traffic-product-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Listing</th>
                  <th>Views</th>
                  <th>Clicks</th>
                  <th>Cart adds</th>
                  <th>Cart rate</th>
                  <th>Orders</th>
                  <th>Units</th>
                </tr>
              </thead>
              <tbody>
                {products.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td>
                      <b>{item.name}</b>
                    </td>
                    <td>{number(item.views)}</td>
                    <td>{number(item.clicks)}</td>
                    <td>{number(item.cart_adds)}</td>
                    <td>
                      <strong>{percent(item.cart_rate)}</strong>
                    </td>
                    <td>{number(item.orders)}</td>
                    <td>{number(item.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="seller-empty-copy">
            Listing analytics will appear after shoppers view products.
          </p>
        )}
      </section>

      <section className="seller-detail-card">
        <header>
          <div>
            <small>VISITOR LOCATIONS</small>
            <h3>
              <MapPin /> Top cities
            </h3>
          </div>
          <span>Coarse Vercel location; no stored IPs</span>
        </header>
        <ProgressList
          entries={locations}
          labelFor={(item) =>
            [item.city, item.region, item.country]
              .filter((value) => value && value !== "—")
              .join(", ")
          }
          valueFor={(item) => item.visitors}
          empty="Locations will appear with new visits."
        />
      </section>

      <section className="seller-detail-card">
        <header>
          <div>
            <small>BUSIEST TIMES</small>
            <h3>
              <Clock3 /> Visitor activity by hour
            </h3>
          </div>
          <span>
            {busiest?.visitors
              ? `Peak: ${hourLabel(busiest.hour)} ET`
              : "Eastern time"}
          </span>
        </header>
        <div className="traffic-hour-grid">
          {hours.map((item) => {
            const intensity = Number(item.visitors || 0) / maxHour;
            return (
              <div
                key={item.hour}
                title={`${hourLabel(item.hour)}: ${number(item.visitors)} visitors, ${number(item.page_views)} page views`}
              >
                <i style={{ opacity: 0.08 + intensity * 0.92 }} />
                <small>{item.hour % 3 === 0 ? hourLabel(item.hour) : ""}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="seller-detail-card">
        <header>
          <div>
            <small>TOP PAGES</small>
            <h3>Most-viewed destinations</h3>
          </div>
        </header>
        <ProgressList
          entries={(report?.pages || []).slice(0, 10)}
          labelFor={(item) => item.path}
          valueFor={(item) => item.page_views}
          empty="Page traffic will appear here."
        />
      </section>

      <section className="seller-detail-card">
        <header>
          <div>
            <small>TRAFFIC SOURCES</small>
            <h3>Where visitors came from</h3>
          </div>
        </header>
        <ProgressList
          entries={(report?.sources || []).slice(0, 10)}
          labelFor={(item) => item.source}
          valueFor={(item) => item.visitors}
          empty="Referring sources will appear here."
        />
      </section>
    </div>
  );
}

export default function TrafficAnalyticsPanel() {
  const [days, setDays] = useState("30");
  const [metric, setMetric] = useState("visitors");
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/admin/traffic?days=${days}`, {
        headers: {
          authorization: `Bearer ${data.session?.access_token || ""}`,
        },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Traffic report could not be loaded.");
      }
      setReport(result.report);
      setUpdatedAt(new Date());
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="enterprise-admin-stack seller-central-dashboard">
      <section className="admin-panel seller-analytics-panel">
        <div className="seller-analytics-title">
          <div>
            <small>STOREFRONT INTELLIGENCE</small>
            <h2>Traffic & conversion</h2>
            <p>
              Daily visitors, shopper behavior, locations, busiest times, and
              performance for every listing.
            </p>
          </div>
          <div className="seller-analytics-actions">
            <button
              type="button"
              className="button button-dark"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        <div className="seller-control-bar">
          <div className="seller-range-switch" aria-label="Traffic report period">
            {RANGES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={days === option.value ? "active" : ""}
                onClick={() => setDays(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="seller-updated">
            {updatedAt
              ? `Updated ${updatedAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "Waiting for report"}
          </span>
        </div>

        {message && (
          <div className="form-message error seller-report-error">
            <b>Traffic report unavailable</b>
            <span>{message}</span>
            <button type="button" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {loading && !report ? (
          <div className="catalog-loading">
            Building secure traffic analytics…
          </div>
        ) : (
          report && (
            <>
              <MetricCards
                report={report}
                metric={metric}
                onMetric={setMetric}
              />
              <RatioCards summary={report.summary} />
              <TrafficChart report={report} metric={metric} />
              <TrafficBreakdowns report={report} />
            </>
          )
        )}
      </section>
    </div>
  );
}
