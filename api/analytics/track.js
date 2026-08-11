import crypto from "node:crypto";
import { json, readJson, service } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

const EVENT_TYPES = new Set([
  "page_view",
  "product_view",
  "listing_click",
  "add_to_cart",
  "checkout_start",
]);
const BOT_PATTERN =
  /bot|crawler|spider|slurp|headless|preview|lighthouse|monitor|uptime/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const digest = (scope, value) =>
  crypto
    .createHash("sha256")
    .update(`goldonthespot:${scope}:${value}`)
    .digest("hex");

const cleanText = (value, maxLength) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);

const cleanLocation = (value, maxLength) => {
  try {
    return cleanText(decodeURIComponent(value || ""), maxLength) || null;
  } catch {
    return cleanText(value, maxLength) || null;
  }
};

const referrerHost = (value) => {
  try {
    return cleanText(new URL(value).hostname.toLowerCase(), 160) || null;
  } catch {
    return null;
  }
};

const safeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const safe = {};
  if (metadata.source) safe.source = cleanText(metadata.source, 40);
  if (metadata.slug) safe.slug = cleanText(metadata.slug, 120);
  const quantity = Number(metadata.quantity);
  if (Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100) {
    safe.quantity = quantity;
  }
  return safe;
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    if (BOT_PATTERN.test(request.headers["user-agent"] || "")) {
      return json(response, 202, { accepted: true });
    }

    const body = await readJson(request, 50_000);
    if (
      !UUID_PATTERN.test(String(body.visitor_id || "")) ||
      !UUID_PATTERN.test(String(body.session_id || "")) ||
      !Array.isArray(body.events) ||
      body.events.length < 1 ||
      body.events.length > 20
    ) {
      return json(response, 400, { error: "Invalid analytics batch" });
    }

    const visitorHash = digest("visitor", body.visitor_id);
    const sessionHash = digest("session", body.session_id);
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await service()
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("session_hash", sessionHash)
      .gte("occurred_at", oneMinuteAgo);
    if (Number(count || 0) >= 120) {
      return json(response, 202, { accepted: true, limited: true });
    }

    const country = cleanText(request.headers["x-vercel-ip-country"], 2);
    const region = cleanText(request.headers["x-vercel-ip-country-region"], 20);
    const city = cleanLocation(request.headers["x-vercel-ip-city"], 80);
    const rows = body.events
      .filter((event) => EVENT_TYPES.has(event?.event_type))
      .map((event) => {
        const path = cleanText(event.path, 300);
        const productId = Number(event.product_id);
        return {
          event_type: event.event_type,
          visitor_hash: visitorHash,
          session_hash: sessionHash,
          product_id:
            Number.isSafeInteger(productId) && productId > 0
              ? productId
              : null,
          path: path.startsWith("/") ? path : "/",
          referrer_host: referrerHost(event.referrer),
          country_code: /^[A-Z]{2}$/.test(country) ? country : null,
          region_code: region || null,
          city,
          timezone: cleanText(event.timezone, 80) || null,
          metadata: safeMetadata(event.metadata),
        };
      });

    if (!rows.length) return json(response, 202, { accepted: true });
    const { error } = await service().from("analytics_events").insert(rows);
    if (error) throw error;
    return json(response, 202, { accepted: true, events: rows.length });
  } catch (error) {
    console.error("analytics tracking failed", error);
    // A telemetry failure must not encourage storefront retries or affect UX.
    return json(response, 202, { accepted: false });
  }
}
