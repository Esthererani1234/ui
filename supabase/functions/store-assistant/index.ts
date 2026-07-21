import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://goldonthespot.com",
  "https://www.goldonthespot.com",
  "http://localhost:5173",
]);

const knowledge = [
  {
    topic: "pricing",
    prompt: "live spot price premiums market-linked prices price changes checkout quote",
    answer: "Eligible bullion prices move with the live USD market price and each listing's saved pricing rule. The displayed amount is an estimate until checkout recalculates it against the latest quote.",
    links: [{ label: "Browse live-priced bullion", to: "/shop" }],
  },
  {
    topic: "shipping",
    prompt: "shipping delivery tracking insurance signature carrier package arrival",
    answer: "Orders are released after payment clears. Shipping is insured and may require a signature based on order value. Tracking appears in the customer account when the shipment is released.",
    links: [{ label: "Shipping information", to: "/shipping" }],
  },
  {
    topic: "payment",
    prompt: "payment methods credit card bank wire ACH certified check surcharge invoice",
    answer: "Checkout can request bank wire, ACH, certified check, or a secure card invoice. Card invoice requests include the disclosed processing surcharge. Never send card numbers or bank credentials in chat.",
    links: [{ label: "Purchase terms", to: "/terms" }],
  },
  {
    topic: "orders",
    prompt: "my order status tracking payment fulfillment confirmation where is shipment",
    answer: "Sign in and open Your Account to see order, payment, fulfillment, totals, and tracking information. The assistant cannot change, cancel, refund, or ship an order.",
    links: [{ label: "View my orders", to: "/account?tab=orders" }],
  },
  {
    topic: "returns",
    prompt: "cancel cancellation return refund exchange bullion order",
    answer: "Precious-metal purchases are market transactions, so ordinary retail cancellation rules may not apply after a price is confirmed. Review the terms and contact support immediately about a specific order.",
    links: [{ label: "Review terms", to: "/terms" }, { label: "Contact support", to: "/support" }],
  },
  {
    topic: "accounts",
    prompt: "account login sign in password email MFA verification profile security",
    answer: "A customer account protects order history and delivery details and provides one secure place to follow payment and fulfillment. Never share passwords or verification codes with the assistant.",
    links: [{ label: "Account help", to: "/account" }],
  },
  {
    topic: "bullion education",
    prompt: "difference compare gold silver platinum palladium coin bar bullion investing choose",
    answer: "Coins and bars can contain the same pure-metal weight. Bars often emphasize efficient metal exposure, while sovereign coins may carry added recognition or collectibility. Gold, silver, platinum, and palladium have different markets and volatility. Compare weight, current price, condition, and product description; this is general education, not personalized investment advice.",
    links: [{ label: "Compare available bullion", to: "/shop" }],
  },
  {
    topic: "authenticity",
    prompt: "authentic genuine purity pure metal weight troy ounce coin bar condition",
    answer: "Use the listing's metal, pure-metal weight, condition, photos, and description to understand exactly what is offered. Pure-metal weight can differ from total item or package weight. Contact support before buying if a listing detail is unclear.",
    links: [{ label: "Browse product listings", to: "/shop" }],
  },
  {
    topic: "support",
    prompt: "human person support representative complaint problem issue help contact",
    answer: "For account-specific, payment, delivery, cancellation, return, or listing questions, open a private support ticket. Include an order number when relevant, but never include passwords, codes, card numbers, or bank credentials.",
    links: [{ label: "Open support", to: "/support" }],
  },
];

const model = new Supabase.ai.Session("gte-small");
let knowledgeVectors: Promise<number[][]> | null = null;

function cors(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://goldonthespot.com";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}

function respond(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function publishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (keys.default) return keys.default;
  } catch { /* legacy projects use SUPABASE_ANON_KEY */ }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

async function embed(text: string) {
  return await model.run(text, { mean_pool: true, normalize: true }) as number[];
}

function similarity(a: number[], b: number[]) {
  const size = Math.min(a.length, b.length);
  let value = 0;
  for (let index = 0; index < size; index += 1) value += a[index] * b[index];
  return value;
}

async function rateLimited(req: Request, client: ReturnType<typeof createClient>) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|gots-store-assistant-v1`));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await client.rpc("check_ai_chat_rate_limit", { p_client_hash: hash });
  return !error && data === false;
}

async function relevantProducts(client: ReturnType<typeof createClient>, message: string) {
  const metals = ["gold", "silver", "platinum", "palladium"];
  const metal = metals.find((item) => message.toLowerCase().includes(item));
  let query = client.from("products").select("slug,name,metal,category,metal_weight_oz,inventory_count").eq("is_active", true).gt("inventory_count", 0).order("sort_order").limit(40);
  if (metal) query = query.eq("metal", metal);
  const { data } = await query;
  const tokens = message.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  return (data || []).map((product: Record<string, unknown>) => {
    const text = `${product.name} ${product.metal} ${product.category}`.toLowerCase();
    return { product, score: tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score).slice(0, 3).map(({ product }) => ({
    name: String(product.name),
    metal: String(product.metal),
    category: String(product.category || "bullion"),
    pure_weight_oz: Number(product.metal_weight_oz || 0),
    to: `/product/${product.slug}`,
  }));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return respond(origin, { error: "Method not allowed" }, 405);
  if (origin && !allowedOrigins.has(origin) && !origin.endsWith(".vercel.app")) return respond(origin, { error: "Origin not allowed" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 10_000) return respond(origin, { error: "Request is too large" }, 413);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return respond(origin, { error: "Invalid request" }, 400); }
  const message = String(body.message || "").trim().slice(0, 800);
  if (!message) return respond(origin, { error: "Ask a question first" }, 400);

  const client = createClient(Deno.env.get("SUPABASE_URL") || "", publishableKey(), { auth: { persistSession: false } });
  if (await rateLimited(req, client)) return respond(origin, { error: "Please wait a few minutes before asking another question." }, 429);

  try {
    if (!knowledgeVectors) knowledgeVectors = Promise.all(knowledge.map((item) => embed(item.prompt)));
    const [questionVector, vectors, products] = await Promise.all([embed(message), knowledgeVectors, relevantProducts(client, message)]);
    const ranked = knowledge.map((item, index) => ({ item, score: similarity(questionVector, vectors[index]) })).sort((a, b) => b.score - a.score);
    const match = ranked[0];
    if (!match || match.score < 0.56) {
      return respond(origin, {
        answer: "I can help with products, live pricing, payment, shipping, accounts, orders, returns, and bullion basics. I can’t verify that answer from the store’s information, so please open a private support ticket.",
        links: [{ label: "Open support", to: "/support" }],
      });
    }
    const productText = products.length && ["bullion education", "authenticity"].includes(match.item.topic)
      ? `\n\nRelevant in-stock listings: ${products.map((product) => `${product.name} (${product.pure_weight_oz} troy oz ${product.metal})`).join("; ")}.`
      : "";
    const productLinks = products.slice(0, 2).map((product) => ({ label: product.name, to: product.to }));
    return respond(origin, { answer: `${match.item.answer}${productText}`, links: [...productLinks, ...match.item.links].slice(0, 3), source: "supabase-semantic" });
  } catch (error) {
    console.error("store-assistant", error);
    return respond(origin, { error: "The store assistant is temporarily unavailable." }, 503);
  }
});
