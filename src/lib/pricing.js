export const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

export const productPrice = (product, spot) => {
  if (!product) return null;
  if (product.price_mode === "fixed") return Number(product.fixed_price || 0);
  if (product.price_mode === "quote") return null;
  const metalSpot = Number(spot?.[product.metal]);
  if (!Number.isFinite(metalSpot)) return null;
  const base = metalSpot * Number(product.metal_weight_oz || 0);
  return base * (1 + Number(product.premium_percent || 0) / 100) + Number(product.premium_fixed || 0);
};

export const orderStatusLabel = (status = "pending") =>
  status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
