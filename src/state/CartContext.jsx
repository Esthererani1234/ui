import { createContext, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "gots-cart-v1";
const cleanCart = (value) => Array.isArray(value) ? value.filter((item) => item && Number.isInteger(Number(item?.product?.id)) && Number(item?.quantity) > 0).map((item) => ({ product: item.product, quantity: Math.min(Math.max(1, Math.floor(Number(item.product.inventory_count) || 1)), Math.max(1, Math.floor(Number(item.quantity)))) })) : [];

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return cleanCart(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      add(product, quantity = 1) {
        const inventory = Math.max(0, Number(product?.inventory_count) || 0);
        if (!product?.id || inventory < 1) return;
        setItems((current) => {
          const existing = current.find((item) => item.product.id === product.id);
          if (existing) {
            return current.map((item) =>
              item.product.id === product.id
                ? { product, quantity: Math.min(item.quantity + Math.max(1, Number(quantity) || 1), inventory) }
                : item,
            );
          }
          return [...current, { product, quantity: Math.min(Math.max(1, Number(quantity) || 1), inventory) }];
        });
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
      },
    }),
    [items],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
