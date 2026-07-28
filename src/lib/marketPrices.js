const CACHE_KEY = "gots-market-prices-v1";
const METALS = ["gold", "silver", "platinum", "palladium"];

let activeRequest = null;
let memoryMarket = null;

const hasValidPrices = (market) =>
  Boolean(
    market?.metals &&
      METALS.every((metal) => {
        const price = Number(market.metals[metal]);
        return Number.isFinite(price) && price > 0;
      }),
  );

export function readCachedMarket() {
  if (hasValidPrices(memoryMarket)) return memoryMarket;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (hasValidPrices(cached)) memoryMarket = cached;
    return memoryMarket;
  } catch {
    return memoryMarket;
  }
}

export function storeCachedMarket(market) {
  if (!hasValidPrices(market)) return null;
  const cached = { ...market, cachedAt: Date.now() };
  memoryMarket = cached;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Prices still remain available in memory when storage is unavailable.
  }
  return cached;
}

export function fetchMarketPrices() {
  if (activeRequest) return activeRequest;

  activeRequest = fetch("/api/metals", {
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      const market = await response.json();
      if (!response.ok || !hasValidPrices(market)) {
        throw new Error("Price feed unavailable");
      }
      return storeCachedMarket(market);
    })
    .finally(() => {
      activeRequest = null;
    });

  return activeRequest;
}
