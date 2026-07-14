import fs from "node:fs";
import path from "node:path";

export default function handler(req, res) {
  const filePath = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(filePath, "utf8");

  const liveScript = `
<script>
(() => {
  const tickerValues = [...document.querySelectorAll('.market-cell .status')];
  const marketStrip = document.querySelector('.market-strip .container');
  const money = value => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

  let lastValues = null;
  let statusLine = document.getElementById('liveMarketStatus');

  if (!statusLine && marketStrip) {
    statusLine = document.createElement('div');
    statusLine.id = 'liveMarketStatus';
    statusLine.style.gridColumn = '1 / -1';
    statusLine.style.padding = '7px 18px';
    statusLine.style.fontSize = '11px';
    statusLine.style.borderTop = '1px solid #d8e0e6';
    statusLine.style.background = '#f8fafb';
    statusLine.style.color = '#687985';
    marketStrip.appendChild(statusLine);
  }

  function setUnavailable(message) {
    tickerValues.forEach(node => {
      node.textContent = 'Unavailable';
      node.style.color = '#c44a4a';
    });
    if (statusLine) {
      statusLine.textContent = message || 'Live precious-metal prices are temporarily unavailable.';
      statusLine.style.color = '#c44a4a';
    }
  }

  function flash(node, direction) {
    node.style.transition = 'color .2s ease';
    node.style.color = direction > 0 ? '#1b8a5a' : direction < 0 ? '#c44a4a' : '#1a2a36';
    window.setTimeout(() => { node.style.color = '#1a2a36'; }, 1800);
  }

  async function updatePrices() {
    try {
      const response = await fetch('/api/metals?ts=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.metals) throw new Error(data?.error || 'Price feed request failed');

      const values = [
        Number(data.metals.gold),
        Number(data.metals.silver),
        Number(data.metals.platinum),
        Number(data.metals.palladium)
      ];

      if (values.some(value => !Number.isFinite(value) || value <= 0)) {
        throw new Error('The provider returned an invalid price');
      }

      tickerValues.forEach((node, index) => {
        const previous = lastValues ? lastValues[index] : null;
        node.textContent = money(values[index]);
        node.classList.remove('status');
        node.classList.add('live-price');
        node.style.fontWeight = '800';
        flash(node, previous === null ? 0 : values[index] - previous);
      });
      lastValues = values;

      const updatedDate = new Date(data.timestamp || Date.now());
      const updated = Number.isNaN(updatedDate.getTime())
        ? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
        : updatedDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

      if (statusLine) {
        statusLine.textContent = (data.stale ? 'CACHED MARKET DATA' : 'LIVE MARKET DATA') +
          ' • Updated ' + updated +
          ' • Source: ' + (data.source || 'Gold-API.com') +
          ' • Refreshes every 30 seconds.';
        statusLine.style.color = data.stale ? '#a25a00' : '#1b8a5a';
        statusLine.style.fontWeight = '700';
      }
    } catch (error) {
      setUnavailable('Live price feed unavailable: ' + (error?.message || 'unknown provider error') + '.');
    }
  }

  setUnavailable('Connecting to the live precious-metals feed…');
  updatePrices();
  window.setInterval(updatePrices, 30000);
})();
</script>`;

  html = html.replace('</body>', liveScript + '</body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).send(html);
}
