export const MARKET_STALE_MS = 120_000;
export function marketStatus(data, { error = false, refreshing = false, now = Date.now() } = {}) {
  if (!data) return error ? 'Prices unavailable' : 'Loading prices';
  if (error) return 'Last price shown';
  if (refreshing) return 'Checking prices';
  const updated = Date.parse(data.timestamp);
  if (!Number.isFinite(updated) || updated > now + 60_000 || now - updated > MARKET_STALE_MS) return 'Last quoted prices';
  return 'Live market';
}
