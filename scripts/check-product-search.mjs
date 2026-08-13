import assert from "node:assert/strict";
import {
  normalizeSearchText,
  productSearchScore,
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
assert.deepEqual(matches("silver buffalo"), []);
assert.ok(
  productSearchScore(products[0], "buffalo") >
    productSearchScore(products[0], "bufalo"),
);

console.log("Product search checks passed.");
