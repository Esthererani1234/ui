import fs from "node:fs";
import path from "node:path";

export default function handler(req, res) {
  const filePath = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(filePath, "utf8");

  const liveScript = `
<script>
(() => {
  const priceNodes = [...document.querySelectorAll('#prices .market-cell .status')];
  const marketStrip = document.querySelector('#prices');
  const symbols = ['XAU', 'XAG', 'XPT', 'XPD'];
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
    statusLine.style.cssText = 'text-align:center;padding:8px 16px;font-size:12px;font-weight:700;background:#fff;border-top:1px solid #d8e0e6;color:#687985';
    marketStrip.appendChild(statusLine);
  }

  function setUnavailable(message) {
    priceNodes.forEach(node => {
      node.textContent = 'Unavailable';
      node.style.color = '#c44a4a';
    });
    if (statusLine) {
      statusLine.textContent = message || 'Live market feed unavailable.';
      statusLine.style.color = '#c44a4a';
    }
  }

  function readPrice(payload) {
    const candidates = [
      payload && payload.price,
      payload && payload.ask,
      payload && payload.value,
      payload && payload.rate,
      payload && payload.close,
      payload && payload.data && payload.data.price
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return value;
    }
    throw new Error('Invalid Gold-API response');
  }

  async function fetchDirectSymbol(symbol) {
    const urls = [
      'https://api.gold-api.com/price/' + symbol,
      'https://api.gold-api.com/price/' + symbol + '/USD'
    ];
    let lastError;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return readPrice(await response.json());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Direct Gold-API request failed');
  }

  async function loadPrices() {
    try {
      const response = await fetch('/api/metals?ts=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.metals) throw new Error(data.error || 'Backend feed unavailable');
      return {
        values: [
          Number(data.metals.gold),
          Number(data.metals.silver),
          Number(data.metals.platinum),
          Number(data.metals.palladium)
        ],
        timestamp: data.timestamp || Date.now(),
        source: data.source || 'Gold-API.com via Vercel',
        stale: Boolean(data.stale)
      };
    } catch (backendError) {
      const values = await Promise.all(symbols.map(fetchDirectSymbol));
      return {
        values,
        timestamp: Date.now(),
        source: 'Gold-API.com direct fallback',
        stale: false
      };
    }
  }

  async function updateSpotPrices() {
    try {
      const result = await loadPrices();
      const values = result.values;
      if (values.some(value => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Invalid metal-price response');
      }

      priceNodes.forEach((node, index) => {
        const old = lastValues ? lastValues[index] : null;
        node.textContent = money(values[index]);
        node.style.color = old === null ? '#1a2a36' : values[index] > old ? '#1b8a5a' : values[index] < old ? '#c44a4a' : '#1a2a36';
        if (old !== null && values[index] !== old) {
          setTimeout(() => { node.style.color = '#1a2a36'; }, 1800);
        }
      });

      lastValues = values;
      if (statusLine) {
        const updated = new Date(result.timestamp || Date.now()).toLocaleTimeString([], {
          hour: 'numeric', minute: '2-digit', second: '2-digit'
        });
        const stale = result.stale ? ' • Cached price' : '';
        statusLine.textContent = 'LIVE SPOT • Updated ' + updated + ' • Source: ' + result.source + stale;
        statusLine.style.color = result.stale ? '#a25a00' : '#1b8a5a';
      }
    } catch (error) {
      setUnavailable('Live spot feed unavailable: ' + (error.message || 'unknown error'));
    }
  }

  setUnavailable('Connecting to live precious-metal prices…');
  updateSpotPrices();
  setInterval(updateSpotPrices, 30000);
})();
</script>`;

  html = html.replace('</body>', liveScript + '</body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).send(html);
}
