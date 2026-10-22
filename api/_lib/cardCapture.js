import { stripeMatchesOrder } from './security.js';

// Every caller supplies an intent retrieved from Stripe, never browser data.
// An authorization is a temporary bank hold, not a settled/paid order.
export async function reconcileCardIntent({db,stripe,order,intent,now=Date.now()}) {
 if(!stripeMatchesOrder(intent,order) || order.payment_provider!=='stripe' || order.provider_payment_id!==intent.id) throw new Error('Payment reconciliation mismatch');
 const manual=intent.capture_method==='manual';
 if(manual && intent.status==='requires_capture') {
  const {data:allowed,error}=await db.rpc('authorize_card_capture',{p_order_id:order.id,p_intent_id:intent.id,p_amount_cents:intent.amount});
  if(error)throw new Error('Capture authorization unavailable');
  if(allowed===true) {
   intent=await stripe.paymentIntents.capture(intent.id,{amount_to_capture:intent.amount},{idempotencyKey:`gots-capture-${intent.id}`,timeout:8000,maxNetworkRetries:0});
  } else {
   intent=await stripe.paymentIntents.cancel(intent.id,{cancellation_reason:'abandoned'},{idempotencyKey:`gots-release-${intent.id}`,timeout:8000,maxNetworkRetries:0});
  }
 } else if(manual && ['requires_action','requires_confirmation','requires_payment_method'].includes(intent.status) && (!order.price_locked_until || Date.parse(order.price_locked_until)<=now || order.status==='cancelled')) {
  intent=await stripe.paymentIntents.cancel(intent.id,{cancellation_reason:'abandoned'},{idempotencyKey:`gots-release-${intent.id}`,timeout:8000,maxNetworkRetries:0});
 }
 if(!stripeMatchesOrder(intent,order))throw new Error('Payment result mismatch');
 let state;
 if(intent.status==='succeeded') {
  if(intent.amount_received!==intent.amount)throw new Error('Payment not fully settled');
  state='paid';
 } else if(intent.status==='canceled')state='expired';
 else if(intent.status==='requires_payment_method')state='failed';
 if(state) {
  const {error}=await db.rpc('mark_payment_state',{p_order_id:order.id,p_provider:'stripe',p_provider_payment_id:intent.id,p_payment_status:state,p_attempt_status:state});
  if(error)throw new Error('Payment state could not be saved');
 }
 return {status:intent.status,expired:intent.status==='canceled'};
}
