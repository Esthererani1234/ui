const VISITOR_KEY = "gots-analytics-visitor-v1";
const SESSION_KEY = "gots-analytics-session-v1";
const queued = [];
const recent = new Map();
let flushTimer = null;
let memoryVisitor = null;
let memorySession = null;

const identifier = (storage, key, memoryValue, remember) => {
  try {
    const existing = storage?.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID();
    storage?.setItem(key, next);
    remember(next);
    return next;
  } catch {
    if (memoryValue) return memoryValue;
    const next = crypto.randomUUID();
    remember(next);
    return next;
  }
};

const visitorId = () =>
  identifier(
    typeof localStorage === "undefined" ? null : localStorage,
    VISITOR_KEY,
    memoryVisitor,
    (value) => {
      memoryVisitor = value;
    },
  );

const sessionId = () =>
  identifier(
    typeof sessionStorage === "undefined" ? null : sessionStorage,
    SESSION_KEY,
    memorySession,
    (value) => {
      memorySession = value;
    },
  );

const analyticsAllowed = () =>
  typeof window !== "undefined" &&
  navigator.doNotTrack !== "1" &&
  window.doNotTrack !== "1";

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flush();
  }, 850);
};

const flush = async () => {
  if (!queued.length) return;
  const events = queued.splice(0, 20);
  try {
    await fetch("/api/analytics/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitor_id: visitorId(),
        session_id: sessionId(),
        events,
      }),
      keepalive: true,
      credentials: "same-origin",
    });
  } catch {
    // Analytics must never interrupt shopping or checkout.
  }
  if (queued.length) scheduleFlush();
};

export function trackEvent(
  eventType,
  { productId = null, path = null, metadata = {} } = {},
) {
  if (!analyticsAllowed()) return;
  const cleanPath = String(path || window.location.pathname || "/").slice(0, 300);
  if (cleanPath.startsWith("/admin")) return;

  const dedupeKey = `${eventType}:${productId || ""}:${cleanPath}`;
  const now = Date.now();
  if (now - Number(recent.get(dedupeKey) || 0) < 700) return;
  recent.set(dedupeKey, now);

  queued.push({
    event_type: eventType,
    product_id: Number.isSafeInteger(Number(productId))
      ? Number(productId)
      : null,
    path: cleanPath,
    referrer: document.referrer || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    metadata,
  });
  if (queued.length >= 10) flush();
  else scheduleFlush();
}

export function trackPageView(path) {
  trackEvent("page_view", { path });
  if (String(path || "").startsWith("/checkout")) {
    trackEvent("checkout_start", { path });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (flushTimer) window.clearTimeout(flushTimer);
    flushTimer = null;
    flush();
  });
}
