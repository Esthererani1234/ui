const SYMBOLS = {
  gold: "GC=F",
  silver: "SI=F",
  platinum: "PL=F",
  palladium: "PA=F"
};

async function loadMetalsDev(apiKey) {
  const url = new URL("https://api.metals.dev/v1/latest");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("currency", "USD");
  url.searchParams.set("unit", "toz");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Metals provider returned ${response.status}`);

  const data = await response.json();
  const source = data.metals || data.rates || data;
  const pick = (...keys) => keys.map(key => source?.[key]).find(value => Number.isFinite(value));
  const metals = {
    gold: pick("gold", "XAU", "xau"),
    silver: pick("silver", "XAG", "xag"),
    platinum: pick("platinum", "XPT", "xpt"),
    palladium: pick("palladium", "XPD", "xpd")
  };

  if (Object.values(metals).some(value => !Number.isFinite(value))) {
    throw new Error("Missing one or more spot prices");
  }

  return {
    metals,
    source: "Metals.Dev spot feed",
    sourceType: "spot",
    updatedAt: data.timestamp || data.date || new Date().toISOString()
  };
}

async function loadYahooContract(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 GoldOnTheSpot/1.0"
    }
  });
  if (!response.ok) throw new Error(`Market feed returned ${response.status}`);
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const lastClose = [...closes].reverse().find(Number.isFinite);
  const price = Number.isFinite(meta?.regularMarketPrice) ? meta.regularMarketPrice : lastClose;
  if (!Number.isFinite(price)) throw new Error(`No price for ${symbol}`);
  return { price, timestamp: meta?.regularMarketTime };
}

async function loadMarketFallback() {
  const entries = await Promise.all(
    Object.entries(SYMBOLS).map(async ([metal, symbol]) => {
      const result = await loadYahooContract(symbol);
      return [metal, result];
    })
  );

  const metals = {};
  let latestTimestamp = 0;
  for (const [metal, result] of entries) {
    metals[metal] = result.price;
    latestTimestamp = Math.max(latestTimestamp, Number(result.timestamp) || 0);
  }

  return {
    metals,
    source: "Live precious-metals futures market",
    sourceType: "futures",
    updatedAt: latestTimestamp ? new Date(latestTimestamp * 1000).toISOString() : new Date().toISOString()
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");

  try {
    let result;
    const apiKey = process.env.METALS_API_KEY;

    if (apiKey) {
      try {
        result = await loadMetalsDev(apiKey);
      } catch (error) {
        result = await loadMarketFallback();
      }
    } else {
      result = await loadMarketFallback();
    }

    return res.status(200).json({
      ok: true,
      currency: "USD",
      unit: "troy_ounce",
      ...result
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Unable to retrieve live precious-metal prices"
    });
  }
}
