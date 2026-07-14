let memoryCache = null;
let memoryCacheTime = 0;
const CACHE_MS = 30_000;

const METALS = {
  gold: "XAU",
  silver: "XAG",
  platinum: "XPT",
  palladium: "XPD"
};

function readPrice(payload) {
  const candidates = [
    payload?.price,
    payload?.ask,
    payload?.value,
    payload?.rate,
    payload?.close,
    payload?.data?.price
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }

  throw new Error("Gold API returned an invalid price");
}

function readTimestamp(payload) {
  return (
    payload?.updatedAt ||
    payload?.updated_at ||
    payload?.timestamp ||
    payload?.date ||
    null
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  const now = Date.now();
  if (memoryCache && now - memoryCacheTime < CACHE_MS) {
    return res.status(200).json({ ...memoryCache, cached: true });
  }

  try {
    const entries = await Promise.all(
      Object.entries(METALS).map(async ([name, symbol]) => {
        const response = await fetch(`https://api.gold-api.com/price/${symbol}/USD`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "GoldOnTheSpot/1.0"
          }
        });

        if (!response.ok) {
          throw new Error(`Gold API ${symbol} request failed with ${response.status}`);
        }

        const payload = await response.json();
        return [name, readPrice(payload), readTimestamp(payload)];
      })
    );

    const metals = Object.fromEntries(entries.map(([name, price]) => [name, price]));
    const providerTimestamps = entries.map(([, , timestamp]) => timestamp).filter(Boolean);

    memoryCache = {
      ok: true,
      metals,
      currency: "USD",
      unit: "troy_ounce",
      timestamp: providerTimestamps[0] || new Date().toISOString(),
      source: "Gold-API.com",
      refreshSeconds: 30
    };
    memoryCacheTime = now;

    return res.status(200).json({ ...memoryCache, cached: false });
  } catch (error) {
    if (memoryCache) {
      return res.status(200).json({
        ...memoryCache,
        cached: true,
        stale: true,
        warning: "Provider temporarily unavailable; showing the most recent cached prices."
      });
    }

    return res.status(502).json({
      ok: false,
      error: error?.message || "Unable to retrieve live precious-metal prices."
    });
  }
}
