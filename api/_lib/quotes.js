import { service } from "./payments.js";

const DEALER_SPOT_ADJUSTMENT = 0.004;
const metals = { gold: "XAU", silver: "XAG", platinum: "XPT", palladium: "XPD" };

const readPrice = (payload) => {
  for (const candidate of [payload?.price, payload?.ask, payload?.mid, payload?.value, payload?.rate, payload?.close]) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  throw new Error("The market feed returned an invalid value");
};

export async function fetchRetailSpot() {
  const entries = await Promise.all(Object.entries(metals).map(async ([name, symbol]) => {
    const response = await fetch(`https://api.gold-api.com/price/${symbol}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("The live market feed is temporarily unavailable");
    const raw = readPrice(await response.json());
    return [name, Math.round(raw * (1 + DEALER_SPOT_ADJUSTMENT) * 1_000_000) / 1_000_000];
  }));
  return Object.fromEntries(entries);
}

export function cleanCart(cart) {
  if (!Array.isArray(cart) || cart.length < 1 || cart.length > 25) {
    throw Object.assign(new Error("Your cart is empty or invalid."), { status: 400 });
  }
  const clean = cart.map((item) => ({
    product_id: Number(item?.product_id),
    quantity: Number(item?.quantity),
  }));
  if (clean.some((item) => !Number.isSafeInteger(item.product_id) || item.product_id < 1
    || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
    throw Object.assign(new Error("One or more cart quantities are invalid."), { status: 400 });
  }
  return clean;
}

const recordSpot = async (spot) => {
  const { error } = await service().from("price_snapshots").insert(
    Object.entries(spot).map(([metal, price]) => ({
      metal,
      price,
      source: "GoldOnTheSpot retail spot",
    })),
  );
  if (error) console.error("price snapshot recording failed", error.message);
};

export async function createQuote(userId, cart) {
  const spot = await fetchRetailSpot();
  const { data, error } = await service().rpc("create_checkout_quote", {
    p_user_id: userId,
    p_cart: cleanCart(cart),
    p_spot: spot,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 409 });
  await recordSpot(spot);
  return data;
}

export async function refreshCardOrder(orderId) {
  const spot = await fetchRetailSpot();
  const { data, error } = await service().rpc("refresh_card_order_quote", {
    p_order_id: orderId,
    p_spot: spot,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 409 });
  await recordSpot(spot);
  return data;
}
