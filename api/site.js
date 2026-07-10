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
  const money = value => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(value);
  let previous = [];

  async function updateSpotPrices() {
    try {
      const response = await fetch('/api/metals?t=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.metals) throw new Error(data.error || 'Unable to load prices');

      const values = [
        data.metals.gold,
        data.metals.silver,
        data.metals.platinum,
        data.metals.palladium
      ];

      cards.forEach((card, index) => {
        const next = values[index];
        if (Number.isFinite(previous[index]) && previous[index] !== next) {
          card.style.color = next > previous[index] ? '#17865b' : '#b94c45';
          setTimeout(() => { card.style.color = ''; }, 1400);
        }
        card.textContent = money(next);
      });
      previous = values;

      const isSpot = data.sourceType === 'spot';
      if (headingText) {
        headingText.textContent = isSpot
          ? 'Live spot prices per troy ounce in U.S. dollars.'
          : 'Live indicative precious-metals market prices per troy ounce in U.S. dollars.';
      }
      if (notice) {
        const updated = new Date(data.updatedAt || Date.now()).toLocaleTimeString([], {
          hour: 'numeric', minute: '2-digit', second: '2-digit'
        });
        notice.textContent = 'LIVE • ' + (data.source || 'Market feed') + ' • Updated ' + updated + ' • Refreshes every 15 seconds.';
        notice.style.color = '#17865b';
        notice.style.fontWeight = '700';
      }
    } catch (error) {
      if (headingText) headingText.textContent = 'Live market feed is temporarily unavailable.';
      if (notice) {
        notice.textContent = 'Prices shown are not current. Please refresh or contact support before ordering.';
        notice.style.color = '#b94c45';
        notice.style.fontWeight = '700';
      }
    }
  }

  updateSpotPrices();
  setInterval(updateSpotPrices, 15000);
})();
</script>`;

  html = html.replace('</body>', liveScript + '</body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(html);
}
