import fs from "node:fs";
import path from "node:path";

export default function handler(req, res) {
  const filePath = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(filePath, "utf8");

  const liveScript = `
<script>
(() => {
  const cards = [...document.querySelectorAll('.price h3')];
  const headingText = document.querySelector('#prices .heading p');
  const notice = document.querySelector('#prices .notice');
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  let lastValues = null;

  function showUnavailable(message) {
    cards.forEach(card => {
      card.textContent = 'Unavailable';
      card.style.color = '#b94c45';
    });
    if (headingText) headingText.textContent = 'A verified live spot-price feed is not connected.';
    if (notice) {
      notice.textContent = message || 'Do not use the displayed catalog estimates for trading or payment.';
      notice.style.color = '#b94c45';
      notice.style.fontWeight = '700';
    }
  }

  async function updateSpotPrices() {
    try {
      const response = await fetch('/api/metals?ts=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.metals) throw new Error(data.error || 'Unable to load prices');

      const values = [
        Number(data.metals.gold),
        Number(data.metals.silver),
        Number(data.metals.platinum),
        Number(data.metals.palladium)
      ];

      if (values.some(value => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Invalid metal-price response');
      }

      cards.forEach((card, index) => {
        const old = lastValues ? lastValues[index] : null;
        card.textContent = money(values[index]);
        card.style.color = old === null ? '#17140d' : values[index] > old ? '#17865b' : values[index] < old ? '#b94c45' : '#17140d';
        setTimeout(() => { card.style.color = '#17140d'; }, 1800);
      });
      lastValues = values;

      if (headingText) headingText.textContent = 'Verified live spot prices per troy ounce in U.S. dollars.';
      if (notice) {
        const updated = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {
          hour: 'numeric', minute: '2-digit', second: '2-digit'
        });
        notice.textContent = 'LIVE SPOT • Updated ' + updated + ' • Source: ' + (data.source || 'verified provider') + '.';
        notice.style.color = '#17865b';
        notice.style.fontWeight = '700';
      }
    } catch (error) {
      showUnavailable('Live spot feed unavailable: ' + (error.message || 'provider not connected') + '.');
    }
  }

  showUnavailable('Connecting to verified live spot feed…');
  updateSpotPrices();
  setInterval(updateSpotPrices, 60000);
})();
</script>`;

  html = html.replace('</body>', liveScript + '</body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).send(html);
}
