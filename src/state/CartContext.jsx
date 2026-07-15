import { createContext, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "gots-cart-v1";

const cleanCart = (value) => {
  if (!Array.isArray(value)) return [];
  const merged = new Map();
  for (const item of value) {
    const productId = Number(item?.product?.id);
    const requested = Math.floor(Number(item?.quantity));
    if (!Number.isInteger(productId) || requested < 1) continue;
    const inventory = Math.max(
      1,
      Math.floor(Number(item.product.inventory_count) || 1),
    );
    const existing = merged.get(productId);
    merged.set(productId, {
      product: item.product,
      quantity: Math.min(inventory, (existing?.quantity || 0) + requested),
    });
  }
  return [...merged.values()];
};

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return cleanCart(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      return [];
    }
  });
  const [lastAdded, setLastAdded] = useState(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      lastAdded,
      clearLastAdded() {
        setLastAdded(null);
      },
      add(product, quantity = 1) {
        const inventory = Math.max(0, Number(product?.inventory_count) || 0);
        const requested = Math.max(1, Math.floor(Number(quantity) || 1));
        const existingQuantity =
          items.find((item) => item.product.id === product?.id)?.quantity || 0;
        const amountToAdd = Math.min(
          requested,
          Math.max(0, inventory - existingQuantity),
        );
        if (!product?.id || inventory < 1 || amountToAdd < 1) return false;
        setItems((current) => {
          const existing = current.find((item) => item.product.id === product.id);
          if (existing) {
            return current.map((item) =>
              item.product.id === product.id
                ? {
                    product,
                    quantity: Math.min(item.quantity + requested, inventory),
                  }
                : item,
            );
          }
          return [
            ...current,
            { product, quantity: Math.min(requested, inventory) },
          ];
        });
        setLastAdded({
          id: crypto.randomUUID(),
          productId: product.id,
          productName: product.name,
          quantity: amountToAdd,
        });
        return true;
      },
      update(productId, quantity) {
        setItems((current) =>
          quantity <= 0
            ? current.filter((item) => item.product.id !== productId)
            : current.map((item) => (item.product.id === productId ? { ...item, quantity: Math.min(Math.max(1, Math.floor(Number(quantity) || 1)), Math.max(0, Number(item.product.inventory_count) || 0)) } : item)).filter((item) => item.quantity > 0),
        );
      },
      reconcileProducts(products) {
        const fresh = new Map(products.map((product) => [product.id, product]));
        setItems((current) => current.filter((item) => fresh.has(item.product.id) && fresh.get(item.product.id).is_active && fresh.get(item.product.id).inventory_count > 0).map((item) => ({ product: fresh.get(item.product.id), quantity: Math.min(item.quantity, fresh.get(item.product.id).inventory_count) })));
      },
      remove(productId) {
        setItems((current) => current.filter((item) => item.product.id !== productId));
      },
      clear() {
        setItems([]);
        setLastAdded(null);
      },
    }),
    [items, lastAdded],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
