export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=55, stale-while-revalidate=300");

  const apiKey = process.env.METALS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: "METALS_API_KEY is not configured" });
  }

  try {
    const url = new URL("https://api.metals.dev/v1/latest");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("currency", "USD");
    url.searchParams.set("unit", "toz");

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);

    const data = await response.json();
    const source = data.metals || data.rates || data;
    const pick = (...keys) => {
      for (const key of keys) {
        const value = source?.[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
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
      throw new Error("Missing one or more metals");
    }

    return res.status(200).json({
      ok: true,
      currency: "USD",
      unit: "troy_ounce",
      updatedAt: data.timestamp || data.date || new Date().toISOString(),
      metals
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: "Unable to retrieve live metal prices" });
  }
}
