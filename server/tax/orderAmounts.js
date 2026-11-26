// Tax-assessed orders store the merchandise subtotal after discounts and all customer charges in USD.
import {cents,TaxReview} from './engine.js';

export function orderTotalCents(order) {
  const total=cents(order.total);
  if(order.tax_amount!=null) {
    const calculated=cents(order.subtotal)+cents(order.shipping_amount ?? 0)+cents(order.payment_surcharge ?? 0)+cents(order.tax_amount);
    if(calculated!==total)throw new TaxReview('The stored tax and order total need reconciliation.');
  }
  return total;
}
