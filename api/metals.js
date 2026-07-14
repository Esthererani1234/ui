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
    payload?.mid,
    payload?.value,
    payload?.rate,
    payload?.close,
    payload?.data?.price,
    payload?.data?.ask,
    payload?.data?.value
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }

  throw new Error("Provider response did not contain a valid price");
}

function readTimestamp(payload) {
  const value = payload?.updatedAt || payload?.updated_at || payload?.timestamp || payload?.date || null;
  if (typeof value === "number") {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return value;
}

async function fetchJsonWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store"
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMetal(symbol) {
  const urls = [
    `https://api.gold-api.com/price/${symbol}`,
    `https://api.gold-api.com/price/${symbol}/USD`
  ];

  const errors = [];
  for (const url of urls) {
    try {
      const payload = await fetchJsonWithTimeout(url);
      return {
        price: readPrice(payload),
        timestamp: readTimestamp(payload),
        endpoint: url
      };
    } catch (error) {
      errors.push(`${url}: ${error?.message || error}`);
    }
  }

  throw new Error(errors.join(" | "));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");

  const now = Date.now();
  if (memoryCache && now - memoryCacheTime < CACHE_MS) {
    return res.status(200).json({ ...memoryCache, cached: true });
  }

  try {
    const results = {};
    const timestamps = [];
    const endpoints = {};

    for (const [name, symbol] of Object.entries(METALS)) {
      const result = await fetchMetal(symbol);
      results[name] = result.price;
      endpoints[name] = result.endpoint;
      if (result.timestamp) timestamps.push(result.timestamp);
    }

    memoryCache = {
      ok: true,
      metals: results,
      currency: "USD",
      unit: "troy_ounce",
      timestamp: timestamps[0] || new Date().toISOString(),
      source: "Gold-API.com",
      refreshSeconds: 30,
      endpoints
    };
    memoryCacheTime = now;

    return res.status(200).json({ ...memoryCache, cached: false });
  } catch (error) {
    if (memoryCache) {
      return res.status(200).json({
        ...memoryCache,
        cached: true,
        stale: true,
        warning: error?.message || "Provider temporarily unavailable"
      });
    }

    return res.status(502).json({
      ok: false,
      error: "Unable to retrieve live precious-metal prices.",
      detail: error?.message || String(error)
    });
  }
}
