import { stripeMatchesOrder } from './security.js';

const claimPattern = /^[a-f0-9]{64}$/;

// Only pass canonical Stripe objects, never a browser-supplied intent.
export async function bindCardIntent({db,order,intent,requestHash}) {
  if (!stripeMatchesOrder(intent,order)) throw new Error('Payment reconciliation mismatch');
  const hash = intent.metadata?.payment_claim;
  if (!claimPattern.test(hash || '') || (requestHash && hash !== requestHash))
    throw new Error('Payment claim mismatch');
  const {data,error} = await db.rpc('bind_card_payment_intent', {
    p_order_id:order.id,p_user_id:order.user_id,p_request_hash:hash,
    p_intent_id:intent.id,p_amount_cents:intent.amount,
  });
  if (error || !data || data.provider_payment_id !== intent.id)
    throw new Error('Payment binding could not be saved');
  return data;
}

// Search is eventually consistent. No match (or multiple matches) retains the
// claim and retries later; it NEVER authorizes creating a replacement charge.
export async function recoverCardIntent({db,stripe,order}) {
  const {data:request,error} = await db.rpc('get_card_payment_recovery',{p_order_id:order.id});
  if (error) throw new Error('Payment recovery unavailable');
  let intent;
  if (request) {
    if (request.legacy) throw new Error('Legacy payment claim requires manual reconciliation');
    if (!claimPattern.test(request.request_hash || '')) throw new Error('Invalid payment claim');
    let id = request.provider_payment_id;
    if (!id) {
      const matches = await stripe.paymentIntents.search({
        query:`metadata['order_id']:'${order.id}' AND metadata['payment_claim']:'${request.request_hash}'`,limit:2,
      });
      if (matches.has_more || !Array.isArray(matches.data) || matches.data.length !== 1) throw new Error('Payment requires further reconciliation');
      id = matches.data[0].id;
    }
    intent = await stripe.paymentIntents.retrieve(id);
    order = await bindCardIntent({db,order,intent,requestHash:request.request_hash});
  } else {
    if (!/^pi_[a-zA-Z0-9]+$/.test(order.provider_payment_id || '')) throw new Error('Payment reference unavailable');
    intent = await stripe.paymentIntents.retrieve(order.provider_payment_id);
  }
  return {order,intent};
}
