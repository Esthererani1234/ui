import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const allowedOrigins = new Set([
  "https://goldonthespot.com",
  "https://www.goldonthespot.com",
  "https://ui-plum-alpha.vercel.app",
  "http://localhost:5173",
]);

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const allowed = allowedOrigins.has(origin) || origin.endsWith(".vercel.app");
  return {
    "access-control-allow-origin": allowed ? origin : "https://goldonthespot.com",
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
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

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

    const body = await request.json();
    if (!Array.isArray(body.cart) || body.cart.length < 1 || body.cart.length > 25) return json(request, { error: "Your cart is invalid." }, 400);
    const cart = body.cart.map((item: { product_id?: unknown; quantity?: unknown }) => ({
      product_id: Number(item.product_id),
      quantity: Number(item.quantity),
    }));
    if (cart.some((item) => !Number.isInteger(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
      return json(request, { error: "One or more cart quantities are invalid." }, 400);
    }

    const spot = await fetchSpot();
    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("create_order", {
      p_user_id: user.id,
      p_contact: body.contact || {},
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
    return json(request, { error: error instanceof Error ? error.message : "Checkout is temporarily unavailable." }, 500);
  }
});
