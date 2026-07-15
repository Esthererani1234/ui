import { money, productPrice } from "./pricing";

export const supportFaqs = [
  {
    id: "live-pricing",
    category: "Pricing",
    question: "How are product prices calculated?",
    answer: "Eligible product prices move with the selected metal's live USD market price and the listing's saved pricing settings. Checkout independently recalculates the price before creating the order.",
    keywords: ["price", "pricing", "spot", "premium", "percent", "live", "below", "above"],
    links: [{ label: "View live-priced products", to: "/shop" }],
  },
  {
    id: "payment",
    category: "Payment",
    question: "Which payment methods are available?",
    answer: "You can request bank wire, ACH, certified check, or a secure card invoice. Wire, ACH, and check have no site surcharge. Card invoice requests currently include the disclosed 4% processing surcharge. Never send card numbers in a support message.",
    keywords: ["payment", "pay", "wire", "ach", "check", "card", "credit", "fee", "surcharge"],
    links: [{ label: "Read purchase terms", to: "/terms" }],
  },
  {
    id: "shipping",
    category: "Shipping",
    question: "How is bullion shipped?",
    answer: "Orders are reviewed and released only after payment clears. The shipping service, insurance, and signature requirement are selected for the order's value. Tracking appears in the customer account when the shipment is released.",
    keywords: ["shipping", "ship", "delivery", "insurance", "insured", "signature", "tracking", "carrier", "ups", "fedex", "usps"],
    links: [{ label: "Shipping and insurance", to: "/shipping" }],
  },
  {
    id: "orders",
    category: "Orders",
    question: "Where can I see my order status?",
    answer: "Sign in and open Your Account to see every order, payment status, fulfillment status, item totals, and tracking information when available.",
    keywords: ["order", "status", "track", "tracking", "where", "confirmation"],
    links: [{ label: "Open your orders", to: "/account?tab=orders" }],
  },
  {
    id: "account",
    category: "Account",
    question: "Why is a customer account required?",
    answer: "The account protects order history and delivery details, lets the server tie an order to a verified customer, and gives you one secure place to follow payment and fulfillment. Full card numbers are not stored by this website.",
    keywords: ["account", "login", "sign in", "profile", "password", "email", "customer"],
    links: [{ label: "Sign in or create an account", to: "/login" }],
  },
  {
    id: "returns",
    category: "Orders",
    question: "Can a bullion order be cancelled or returned?",
    answer: "Precious-metal orders are market transactions, so cancellation and return rules differ from ordinary retail purchases. Do not assume an order can be cancelled after its price is confirmed. Review the terms and contact support immediately about a specific order.",
    keywords: ["cancel", "cancellation", "return", "refund", "exchange"],
    links: [{ label: "Review the terms", to: "/terms" }, { label: "Contact support", to: "/support" }],
  },
  {
    id: "authenticity",
    category: "Products",
    question: "How do I understand a product listing?",
    answer: "Each listing shows its metal, product type, pure-metal weight, current selling price, inventory, and description. The pure-metal weight is different from the total package weight.",
    keywords: ["authentic", "purity", "pure", "weight", "ounce", "oz", "coin", "bar", "listing"],
    links: [{ label: "Browse the catalog", to: "/shop" }],
  },
  {
    id: "large-order",
    category: "Orders",
    question: "What if I want to place a large order?",
    answer: "For a large purchase, contact support before checkout so availability, payment timing, identity verification, and secure fulfillment can be confirmed. Do not send bank or identity documents through the assistant.",
    keywords: ["large", "bulk", "wholesale", "10000", "50000", "big order", "high value"],
    links: [{ label: "Open secure support", to: "/support" }],
  },
];

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9%$+.-]+/g, " ").trim();
const metalNames = ["gold", "silver", "platinum", "palladium"];

export function getLocalSupportAnswer(message, { products = [], spot = null, signedIn = false } = {}) {
  const input = normalize(message);
  const tokens = new Set(input.split(/\s+/).filter((token) => token.length > 1));
  const mentionedMetal = metalNames.find((metal) => tokens.has(metal));
  const weightMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:troy\s*)?(?:oz|ounce|ounces)\b/);
  const adjustmentMatch = input.match(/([+-]?\d+(?:\.\d+)?)\s*%/);

  if (mentionedMetal && weightMatch && Number(spot?.[mentionedMetal]) > 0) {
    const weight = Number(weightMatch[1]);
    const adjustment = adjustmentMatch ? Number(adjustmentMatch[1]) : 0;
    if (weight > 0 && weight <= 10000 && adjustment >= -99 && adjustment <= 99) {
      const estimate = Number(spot[mentionedMetal]) * weight * (1 + adjustment / 100);
      const rule = adjustment === 0 ? "at spot" : `${Math.abs(adjustment)}% ${adjustment < 0 ? "below" : "above"} spot`;
      return {
        text: `Using the current site feed, ${weight} troy oz of pure ${mentionedMetal} ${rule} is about ${money(estimate)}. This is an educational estimate; an actual listing and checkout use the product's saved rule and a fresh server price.`,
        links: [{ label: `Shop ${mentionedMetal}`, to: `/shop?metal=${mentionedMetal}` }],
      };
    }
  }

  if ((tokens.has("price") || tokens.has("prices") || tokens.has("spot") || tokens.has("worth") || tokens.has("today") || tokens.has("current") || tokens.has("live")) && spot) {
    if (mentionedMetal && Number(spot[mentionedMetal]) > 0) {
      return {
        text: `Current ${mentionedMetal} spot from the site's live feed is ${money(spot[mentionedMetal])} per troy ounce. Product selling prices use current market data and each listing's saved pricing settings.`,
        links: [{ label: `Shop ${mentionedMetal}`, to: `/shop?metal=${mentionedMetal}` }],
      };
    }
    const prices = metalNames.filter((metal) => Number(spot[metal]) > 0).map((metal) => `${metal[0].toUpperCase()}${metal.slice(1)} ${money(spot[metal])}`).join(" • ");
    return { text: `Current site feed: ${prices}. These are USD spot prices per troy ounce and refresh automatically.`, links: [{ label: "Shop all metals", to: "/shop" }] };
  }

  if (mentionedMetal && (tokens.has("buy") || tokens.has("product") || tokens.has("products") || tokens.has("recommend") || tokens.has("available"))) {
    const matches = products.filter((product) => product.metal === mentionedMetal && product.is_active).slice(0, 3);
    if (!matches.length) return { text: `There are no active ${mentionedMetal} listings right now. Inventory is controlled by the store owner, so check again or open a support request.`, links: [{ label: "Contact support", to: "/support" }] };
    const list = matches.map((product) => {
      const price = productPrice(product, spot);
      return `${product.name}${price == null ? "" : ` (${money(price)})`}`;
    }).join("; ");
    return { text: `Available ${mentionedMetal} listings include: ${list}. Prices shown are live estimates and checkout recalculates them.`, links: [{ label: `Shop ${mentionedMetal}`, to: `/shop?metal=${mentionedMetal}` }] };
  }

  if (/what.*(?:available|sell)|products?|inventory|recommend/.test(input) && products.length) {
    const available = products.filter((product) => product.is_active && Number(product.inventory_count) > 0).slice(0, 3);
    if (!available.length) return { text: "There are no active in-stock listings right now. The store owner controls the live catalog, so check again or contact support.", links: [{ label: "Contact support", to: "/support" }] };
    const list = available.map((product) => {
      const price = productPrice(product, spot);
      return `${product.name}${price == null ? "" : ` (${money(price)})`}`;
    }).join("; ");
    return { text: `Current in-stock listings include: ${list}. Open the catalog for all available products and exact live estimates.`, links: [{ label: "Browse the catalog", to: "/shop" }] };
  }

  if (/human|person|agent|representative|contact|help desk/.test(input)) {
    return {
      text: signedIn ? "You can open a private support ticket from the Support page. Include the order number if your question concerns an order, but never include passwords, card numbers, or bank credentials." : "Sign in to open a private support ticket tied to your account, or email support@goldonthespot.com. Never email passwords, card numbers, or bank credentials.",
      links: [{ label: signedIn ? "Open support" : "Sign in for support", to: signedIn ? "/support" : "/login?return=/support" }],
    };
  }

  let best = null;
  let bestScore = 0;
  for (const item of supportFaqs) {
    let score = 0;
    for (const keyword of item.keywords) {
      if (input.includes(keyword)) score += keyword.includes(" ") ? 4 : 2;
      else if (tokens.has(keyword)) score += 1;
    }
    if (score > bestScore) { best = item; bestScore = score; }
  }

  if (best && bestScore >= 2) return { text: best.answer, links: best.links };
  if (/hello|hi|hey|good morning|good afternoon/.test(input)) return { text: "Hi! I can explain live prices, products, payments, shipping, accounts, order tracking, and support. What would you like to know?", links: [] };

  return {
    text: "I’m not certain enough to give you a reliable answer to that. Try asking about live prices, a metal, payment, shipping, an order, or your account—or open a private support ticket for a person.",
    links: [{ label: "Open support", to: signedIn ? "/support" : "/login?return=/support" }],
  };
}
