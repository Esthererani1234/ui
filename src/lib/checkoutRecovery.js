const STORAGE_KEY = "gots-checkout-recovery-v1";

const safeStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function saveCheckoutRecovery({ orderId, orderNumber, priceLockedUntil, paymentMethod, items }) {
  const normalizedItems = (items || [])
    .map((item) => ({
      productId: Number(item?.product?.id ?? item?.productId),
      quantity: Math.max(1, Math.floor(Number(item?.quantity) || 1)),
    }))
    .filter((item) => Number.isSafeInteger(item.productId) && item.productId > 0);

  if (!Number.isSafeInteger(Number(orderId)) || !orderNumber || !normalizedItems.length) return;

  safeStorage()?.setItem(STORAGE_KEY, JSON.stringify({
    orderId: Number(orderId),
    orderNumber: String(orderNumber),
    priceLockedUntil: priceLockedUntil || null,
    paymentMethod: paymentMethod || "card",
    items: normalizedItems,
    savedAt: new Date().toISOString(),
  }));
}

export function readCheckoutRecovery() {
  try {
    const recovery = JSON.parse(safeStorage()?.getItem(STORAGE_KEY) || "null");
    if (!recovery || !Number.isSafeInteger(Number(recovery.orderId)) || !recovery.orderNumber || !Array.isArray(recovery.items)) return null;
    return recovery;
  } catch {
    return null;
  }
}

export function clearCheckoutRecovery(orderNumber) {
  const storage = safeStorage();
  if (!storage) return;
  const recovery = readCheckoutRecovery();
  if (!orderNumber || recovery?.orderNumber === orderNumber) storage.removeItem(STORAGE_KEY);
}
