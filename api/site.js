import fs from "node:fs";
import path from "node:path";

const money = value => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(value);

export default async function handler(req, res) {
  const filePath = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(filePath, "utf8");

  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const endpoint = `${protocol}://${host}/api/metals`;

  let initialData = null;
  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await response.json();
    if (response.ok && data?.metals) initialData = data;
  } catch {
    initialData = null;
  }

  if (initialData?.metals) {
    const values = [
      initialData.metals.gold,
      initialData.metals.silver,
      initialData.metals.platinum,
      initialData.metals.palladium
    ];
    for (const value of values) {
      html = html.replace("Unavailable", money(Number(value)));
    }
  }

  const serialized = JSON.stringify(initialData || null).replace(/</g, "\\u003c");
  const liveScript = `
<script>
(() => {
  const nodes = Array.from(document.querySelectorAll('#prices .market-cell .status'));
  const marketStrip = document.querySelector('#prices');
  let previous = null;
  let statusLine = document.getElementById('liveMarketStatus');

  if (!statusLine && marketStrip) {
    statusLine = document.createElement('div');
    statusLine.id = 'liveMarketStatus';
    statusLine.style.cssText = 'text-align:center;padding:8px 16px;font-size:12px;font-weight:700;background:#fff;border-top:1px solid #d8e0e6;color:#687985';
    marketStrip.appendChild(statusLine);
  }

  const formatMoney = value => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(value);

  function display(data) {
    const values = [data.metals.gold, data.metals.silver, data.metals.platinum, data.metals.palladium].map(Number);
    if (values.length !== 4 || values.some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Invalid price data');

    nodes.forEach((node, i) => {
      const old = previous ? previous[i] : null;
      node.textContent = formatMoney(values[i]);
      node.style.color = old == null ? '#1a2a36' : values[i] > old ? '#1b8a5a' : values[i] < old ? '#c44a4a' : '#1a2a36';
      if (old != null && old !== values[i]) setTimeout(() => node.style.color = '#1a2a36', 1600);
    });
    previous = values;

    if (statusLine) {
      const updated = new Date(data.timestamp || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      statusLine.textContent = 'LIVE SPOT • Updated ' + updated + ' • Source: ' + (data.source || 'Gold-API.com') + (data.cached ? ' • Cached up to 30 seconds' : '');
      statusLine.style.color = data.stale ? '#a25a00' : '#1b8a5a';
    }
  }

  function unavailable(message) {
    if (!previous) nodes.forEach(node => { node.textContent = 'Unavailable'; node.style.color = '#c44a4a'; });
    if (statusLine) { statusLine.textContent = message; statusLine.style.color = '#c44a4a'; }
  }

  async function refresh() {
    try {
      const response = await fetch('/api/metals?refresh=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.metals) throw new Error(data.detail || data.error || 'Price request failed');
      display(data);
    } catch (error) {
      unavailable('Price refresh failed. Retrying automatically.');
    }
  }

  const initial = ${serialized};
  if (initial && initial.metals) display(initial);
  else refresh();
  setInterval(refresh, 30000);
})();
</script>`;

  html = html.replace("</body>", liveScript + "</body>");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  return res.status(200).send(html);
}
