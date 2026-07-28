import { supabase } from "./supabase";

const CACHE_KEY = "gots-active-products-v1";
let memoryProducts = null;
let activeRequest = null;

const isProduct = (product) =>
  Boolean(
    product &&
      (typeof product.id === "number" || typeof product.id === "string") &&
      typeof product.name === "string" &&
      typeof product.slug === "string" &&
      product.is_active === true,
  );

const validateProducts = (products) =>
  Array.isArray(products) && products.every(isProduct) ? products : null;

export function readCachedProducts() {
  if (memoryProducts) return memoryProducts;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    const products = validateProducts(cached?.products);
    if (products) memoryProducts = products;
  } catch {
    // The in-memory cache still works when browser storage is unavailable.
  }
  return memoryProducts;
}

function storeProducts(products) {
  const valid = validateProducts(products) || [];
  memoryProducts = valid;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ products: valid, cachedAt: Date.now() }),
    );
  } catch {
    // The catalog remains available in memory for this browser session.
  }
  return valid;
}

export function fetchActiveProducts() {
  if (activeRequest) return activeRequest;

  activeRequest = supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("sort_order")
    .then(({ data, error }) => {
      if (error) throw error;
      return storeProducts(data || []);
    })
    .finally(() => {
      activeRequest = null;
    });

  return activeRequest;
}

export function findCachedProduct(slug) {
  return readCachedProducts()?.find((product) => product.slug === slug) || null;
}
