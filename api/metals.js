export const config = { runtime: "edge" };

const METALS = {
  gold: "XAU",
  silver: "XAG",
  platinum: "XPT",
  palladium: "XPD"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, s-maxage=30, stale-while-revalidate=120",
      ...extraHeaders
    }
  });
}

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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*"
    },
    cf: { cacheTtl: 30, cacheEverything: true }
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 100)}`);
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function fetchMetal(symbol) {
  const urls = [
    `https://api.gold-api.com/price/${symbol}`,
    `https://api.gold-api.com/price/${symbol}/USD`
  ];

  const errors = [];
  for (const url of urls) {
    try {
      const payload = await fetchJson(url);
      return {
        price: readPrice(payload),
        timestamp: readTimestamp(payload)
      };
    } catch (error) {
      errors.push(`${url}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type"
      }
    });
  }

  try {
    const entries = await Promise.all(
      Object.entries(METALS).map(async ([name, symbol]) => {
        const result = await fetchMetal(symbol);
        return [name, result];
      })
    );

    const metals = {};
    const timestamps = [];

    for (const [name, result] of entries) {
      metals[name] = result.price;
      if (result.timestamp) timestamps.push(result.timestamp);
    }

    return json({
      ok: true,
      metals,
      currency: "USD",
      unit: "troy_ounce",
      timestamp: timestamps[0] || new Date().toISOString(),
      source: "Gold-API.com via Vercel Edge",
      refreshSeconds: 30
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Unable to retrieve live precious-metal prices."
    }, 502, { "cache-control": "no-store" });
  }
}
