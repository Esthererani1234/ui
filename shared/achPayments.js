// Amounts in this module are integer USD cents. Never accept browser totals.
export const ACH_MAXIMUM_CENTS = 2_500_000;
export const ACH_FEE_BASIS_POINTS = 200;

export function calculateAchTotals({ subtotalCents, shippingCents = 0, taxCents = 0 }) {
  for (const amount of [subtotalCents, shippingCents, taxCents]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > ACH_MAXIMUM_CENTS) {
      throw new Error('Invalid ACH order amount');
    }
  }
  if (subtotalCents === 0) throw new Error('ACH requires a positive merchandise subtotal');
  const feeCents = Math.round(subtotalCents * ACH_FEE_BASIS_POINTS / 10000);
  const totalCents = subtotalCents + shippingCents + taxCents + feeCents;
  if (totalCents > ACH_MAXIMUM_CENTS) throw new Error('ACH order total exceeds $25,000');
  return { subtotalCents, shippingCents, taxCents, feeCents, totalCents };
}

export function achIntentMatchesOrder(intent, order) {
  return order.payment_method === 'ach'
    && intent.currency === 'usd'
    && Number.isSafeInteger(intent.amount) && intent.amount > 0
    && intent.amount <= ACH_MAXIMUM_CENTS
    && intent.amount === Math.round(Number(order.total) * 100)
    && intent.metadata?.order_id === String(order.id)
    && intent.metadata?.user_id === order.user_id
    && intent.payment_method_types?.length === 1
    && intent.payment_method_types[0] === 'us_bank_account'
    && order.payment_provider === 'stripe'
    && order.provider_payment_id === intent.id;
}

export function achPaymentIsConfirmed(intent, order) {
  return achIntentMatchesOrder(intent, order)
    && intent.status === 'succeeded'
    && intent.amount_received === intent.amount;
}
