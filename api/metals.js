export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=120");

  const apiKey = process.env.METALS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "METALS_API_KEY is not configured in Vercel." });
  }

  try {
    const url = new URL("https://api.metals.dev/v1/latest");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("currency", "USD");
    url.searchParams.set("unit", "toz");

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || data?.error || "Metals provider request failed");

    const source = data.metals || data.rates || data;
    const pick = (...keys) => {
      for (const key of keys) {
        const value = source?.[key];
        if (Number.isFinite(Number(value))) return Number(value);
      }
      return null;
    };

    const metals = {
      gold: pick("gold", "XAU", "xau"),
      silver: pick("silver", "XAG", "xag"),
      platinum: pick("platinum", "XPT", "xpt"),
      palladium: pick("palladium", "XPD", "xpd")
    };

    if (Object.values(metals).some(value => value === null)) {
      throw new Error("Provider response did not include all four metals.");
    }

    return res.status(200).json({
      metals,
      currency: "USD",
      unit: "troy_ounce",
      timestamp: data.timestamp || new Date().toISOString(),
      source: "metals.dev"
    });
  } catch (error) {
    return res.status(502).json({ error: error.message || "Unable to load live metal prices." });
  }
}
