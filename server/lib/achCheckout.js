import {calculateAchTotals,achPaymentIsConfirmed} from '../../shared/achPayments.js';

// Called only with an authenticated owner's server-loaded order. Bank details
// remain inside Stripe Elements and are represented by a confirmation token.
export function buildAchIntent(order, confirmationTokenId, claimHash, now = Date.now()) {
  if(order.payment_method !== 'ach' || !['pending_review','awaiting_payment'].includes(order.status)
    || !['unpaid','failed'].includes(order.payment_status)) throw new Error('Order cannot accept ACH payment');
  if(!Number.isSafeInteger(order.id) || order.id < 1 || !order.user_id) throw new Error('Invalid order identity');
  if(!/^ctoken_[A-Za-z0-9]+$/.test(confirmationTokenId) || !/^[a-f0-9]{64}$/.test(claimHash)) throw new Error('Invalid payment confirmation');
  const expires = Date.parse(order.price_locked_until);
  if(!Number.isFinite(expires) || now >= expires) throw new Error('Price lock expired');
  const cents = value => {
    const n = Number(value);
    if(!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw new Error('Invalid stored amount');
    return Math.round(n * 100);
  };
  const totals = calculateAchTotals({subtotalCents:cents(order.subtotal),shippingCents:cents(order.shipping_amount || 0),taxCents:cents(order.tax_amount || 0)});
  if(cents(order.payment_surcharge)!==totals.feeCents || cents(order.total)!==totals.totalCents) throw new Error('Stored ACH amount mismatch');
  return {
    amount:totals.totalCents,currency:'usd',confirm:true,
    confirmation_token:confirmationTokenId,
    payment_method_types:['us_bank_account'],
    payment_method_options:{us_bank_account:{verification_method:'instant'}},
    metadata:{order_id:String(order.id),user_id:order.user_id,payment_claim:claimHash},
    description:`GoldOnTheSpot order ${order.order_number}`,
  };
}

// Processing is not permission to fulfill. Settled funds still require the
// existing order-risk review; this helper does not change shipping status.
export function achSettlementState(intent, order) {
  if(achPaymentIsConfirmed(intent,order)) return 'paid';
  if(intent.status === 'processing') return 'pending';
  return 'unconfirmed';
}
