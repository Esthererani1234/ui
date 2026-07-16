import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const allowedOrigins = new Set([
  "https://goldonthespot.com",
  "https://www.goldonthespot.com",
  "https://ui-plum-alpha.vercel.app",
  "https://ui-git-agent-goldonthespot-store-esther-eranis-projects.vercel.app",
  "http://localhost:5173",
]);

const isAllowedOrigin = (request: Request) => allowedOrigins.has(request.headers.get("origin") || "");

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    ...(allowedOrigins.has(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
};

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const readDefaultKey = (modernName: string, legacyName: string) => {
  const modern = Deno.env.get(modernName);
  if (modern) return JSON.parse(modern).default as string;
  return Deno.env.get(legacyName) || "";
};

const readPrice = (payload: Record<string, unknown>) => {
  const candidates = [payload.price, payload.ask, payload.mid, payload.value, payload.rate, payload.close];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  throw new Error("The market feed returned an invalid value");
};

const jwtPayload = (token: string) => {
  try {
    const encoded = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

async function fetchSpot() {
  const metals = { gold: "XAU", silver: "XAG", platinum: "XPT", palladium: "XPD" } as const;
  const entries = await Promise.all(Object.entries(metals).map(async ([name, symbol]) => {
    const response = await fetch(`https://api.gold-api.com/price/${symbol}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("The live market feed is temporarily unavailable");
    const payload = await response.json();
    return [name, readPrice(payload)] as const;
  }));
  return Object.fromEntries(entries) as Record<string, number>;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request)) return new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (!isAllowedOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 50_000) return json(request, { error: "Checkout request is too large." }, 413);
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json(request, { error: "Content-Type must be application/json." }, 415);
  }

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(request, { error: "Please sign in before checkout." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = readDefaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = readDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !secretKey) throw new Error("The checkout service is not configured");

    const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.slice(7);
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json(request, { error: "Your session expired. Please sign in again." }, 401);

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 50_000) return json(request, { error: "Checkout request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(request, { error: "Checkout request must be a JSON object." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json(request, { error: "Checkout request must be valid JSON." }, 400);
    }

    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: risk }, { data: securitySettings }, { data: mfaRows }] =
      await Promise.all([
        admin
          .from("customer_risk_profiles")
          .select("status, checkout_disabled")
          .eq("user_id", user.id)
          .maybeSingle(),
        admin
          .from("app_settings")
          .select("key, value")
          .in("key", ["sms_provider_ready", "customer_sms_mfa_required", "accepting_orders"]),
        admin.rpc("admin_customer_security_summary"),
      ]);
    if (risk?.status === "blocked" || risk?.checkout_disabled)
      return json(request, { error: "Checkout is disabled for this account. Contact support for review." }, 403);
    const authSettings = Object.fromEntries(
      (securitySettings || []).map((row) => [row.key, row.value]),
    );
    if (authSettings.accepting_orders === false)
      return json(request, { error: "Checkout is temporarily paused. Your cart is saved; please try again later." }, 503);
    const smsRequired =
      Boolean(authSettings.sms_provider_ready) &&
      Boolean(authSettings.customer_sms_mfa_required);
    const customerMfa = (mfaRows || []).find((row) => row.user_id === user.id);
    if (
      smsRequired &&
      (jwtPayload(token).aal !== "aal2" || !customerMfa?.has_phone_mfa)
    )
      return json(request, { error: "Verify the SMS code on your account before checkout." }, 403);

    const { data: withinLimit, error: limitError } = await admin.rpc("check_checkout_rate_limit", { p_user_id: user.id });
    if (limitError) throw limitError;
    if (!withinLimit) return json(request, { error: "Too many checkout attempts. Please wait and try again." }, 429);

    if (!Array.isArray(body.cart) || body.cart.length < 1 || body.cart.length > 25) return json(request, { error: "Your cart is invalid." }, 400);
    const cart = body.cart.map((item: { product_id?: unknown; quantity?: unknown }) => ({
      product_id: Number(item.product_id),
      quantity: Number(item.quantity),
    }));
    if (cart.some((item) => !Number.isInteger(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
      return json(request, { error: "One or more cart quantities are invalid." }, 400);
    }

    const spot = await fetchSpot();
    const contact =
      body.contact && typeof body.contact === "object"
        ? { ...(body.contact as Record<string, unknown>), email: user.email }
        : { email: user.email };
    const { data, error } = await admin.rpc("create_order", {
      p_user_id: user.id,
      p_contact: contact,
      p_shipping: body.shipping || {},
      p_cart: cart,
      p_spot: spot,
      p_payment_method: body.payment_method,
      p_notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null,
    });
    if (error) {
      console.error("create_order failed", error.code, error.message);
      const customerSafe = /inventory|unavailable|address|contact|payment|cart|quote|quantity|account/i.test(error.message)
        ? error.message
        : "We could not lock this order. Please refresh the cart and try again.";
      return json(request, { error: customerSafe }, 400);
    }

    await admin.from("price_snapshots").insert(Object.entries(spot).map(([metal, price]) => ({ metal, price, source: "Gold-API.com" })));
    return json(request, data, 201);
  } catch (error) {
    console.error("checkout error", error);
    return json(request, { error: "Checkout is temporarily unavailable. Please try again." }, 500);
  }
});
