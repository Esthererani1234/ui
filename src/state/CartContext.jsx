import { createContext, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "gots-cart-v1";

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
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
        setItems((current) => {
          const existing = current.find((item) => item.product.id === product.id);
          if (existing) {
            return current.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: Math.min(item.quantity + quantity, product.inventory_count || 99) }
                : item,
            );
          }
          return [...current, { product, quantity }];
        });
      },
      update(productId, quantity) {
        setItems((current) =>
          quantity <= 0
            ? current.filter((item) => item.product.id !== productId)
            : current.map((item) => (item.product.id === productId ? { ...item, quantity } : item)),
        );
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
