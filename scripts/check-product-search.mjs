import assert from "node:assert/strict";
import {
  normalizeSearchText,
  productSearchScore,
  searchProducts,
  suggestSearchCorrection,
  understandSearchQuery,
} from "../src/lib/productSearch.js";

const products = [
  {
    id: 1,
    name: "1 oz American Gold Buffalo Proof Coin (Random Year) - .9999 Fine Gold",
    sku: "GBUF-PROOF-1OZ",
    slug: "american-gold-buffalo-proof",
    metal: "gold",
    category: "coin",
    short_description: "United States Mint proof buffalo",
  },
  {
    id: 2,
    name: "1 oz American Gold Eagle BU (Random Year)",
    sku: "AGE-BU-1OZ",
    slug: "american-gold-eagle-bu",
    metal: "gold",
    category: "coin",
    short_description: "Sovereign bullion coin",
  },
  {
    id: 3,
    name: "1 oz Canadian Silver Maple Leaf Coin",
    sku: "SML-1OZ",
    slug: "canadian-silver-maple-leaf",
    metal: "silver",
    category: "coin",
    short_description: "Royal Canadian Mint",
  },
  {
    id: 4,
    name: "10g PAMP Suisse Gold Bar",
    sku: "PAMP-AU-10G",
    slug: "pamp-suisse-10g-gold-bar",
    metal: "gold",
    category: "bar",
    short_description: "Investment gold bar",
  },
  {
    id: 5,
    name: "1 oz Platinum Bar",
    sku: "PT-BAR-1OZ",
    slug: "platinum-bar-1oz",
    metal: "platinum",
    category: "bar",
    short_description: "Investment-grade platinum",
  },
  {
    id: 6,
    name: "1/4 oz American Gold Eagle Coin",
    sku: "AGE-BU-QUARTER-OZ",
    slug: "quarter-ounce-american-gold-eagle",
    metal: "gold",
    category: "coin",
    short_description: "Quarter-ounce sovereign bullion coin",
  },
  {
    id: 7,
    name: "1 oz South African Gold Krugerrand Coin",
    sku: "KRUG-1OZ",
    slug: "south-african-gold-krugerrand",
    metal: "gold",
    category: "coin",
    short_description: "Classic South African bullion coin",
  },
  {
    id: 8,
    name: "1 oz Valcambi Suisse Gold Bar",
    sku: "VALC-AU-1OZ",
    slug: "valcambi-suisse-gold-bar",
    metal: "gold",
    category: "bar",
    short_description: "Swiss refinery minted bar",
  },
];

const matches = (query) =>
  products
    .map((product) => ({ product, score: productSearchScore(product, query) }))
    .filter(({ score }) => score !== null)
    .sort((left, right) => right.score - left.score)
    .map(({ product }) => product.id);

assert.equal(normalizeSearchText("10 Grams"), "10 g");
assert.equal(normalizeSearchText("1OZT BUFFALOS"), "1 oz buffalo");
assert.equal(matches("bufalo")[0], 1);
assert.equal(matches("1oz bufflo")[0], 1);
assert.equal(matches("american egale")[0], 2);
assert.equal(matches("silver mapel")[0], 3);
assert.equal(matches("10grams pamp")[0], 4);
assert.equal(matches("goldbar")[0], 4);
assert.equal(matches("platinm")[0], 5);
assert.equal(matches("AU buffalo")[0], 1);
assert.equal(matches("one ounce bufalo")[0], 1);
assert.equal(matches("quarter ounce eagle")[0], 6);
assert.equal(matches("golbuflo")[0], 1);
assert.equal(matches("gld bufflo")[0], 1);
assert.equal(matches("goldbuffalo")[0], 1);
assert.equal(matches("buffalo gold american")[0], 1);
assert.equal(matches("krugerand")[0], 7);
assert.equal(matches("valcambe gold")[0], 8);
assert.deepEqual(matches("silver buffalo"), []);
assert.ok(
  productSearchScore(products[0], "buffalo") >
    productSearchScore(products[0], "bufalo"),
);
assert.equal(searchProducts(products, "amercan egale", 1)[0].id, 2);
assert.equal(searchProducts(products, "show me a krugerand coin please", 1)[0].id, 7);
assert.ok(searchProducts(products, "cheap gold bars under $5,000").length > 0);
assert.equal(suggestSearchCorrection(products, "bufalo"), "buffalo");
assert.equal(
  suggestSearchCorrection(products, "amercan egale"),
  "american eagle",
);
assert.equal(suggestSearchCorrection(products, "golbuflo"), "gold buffalo");
assert.equal(suggestSearchCorrection(products, "krugerand"), "krugerrand");
assert.deepEqual(understandSearchQuery("show me cheap gold bars under $5,000"), {
  terms: "gold bar",
  inStock: false,
  featured: false,
  newest: false,
  maximumPrice: 5000,
  minimumPrice: null,
  sort: "price-low",
});
assert.equal(understandSearchQuery("latest silver coins in stock").terms, "silver coin");
assert.equal(understandSearchQuery("latest silver coins in stock").inStock, true);
assert.equal(understandSearchQuery("latest silver coins in stock").newest, true);

console.log("Product search checks passed.");
