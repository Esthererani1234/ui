import Stripe from 'stripe';
import {authenticateCustomer,customerOrder,json,readJson,service} from '../_lib/payments.js';
import {rateLimit,strictObject,securityLog} from '../_lib/security.js';
import {reconcileCardIntent} from '../_lib/cardCapture.js';
export const config={api:{bodyParser:false}};
export default async function handler(request,response) {
 if(request.method!=='POST')return json(response,405,{error:'Method not allowed'});
 try {
  const {user}=await authenticateCustomer(request,{requireSms:true});
  const db=service();await rateLimit(db,'card_complete',user.id,20,600);
  const body=strictObject(await readJson(request),['order_id']);
  const id=Number(body.order_id);if(!Number.isSafeInteger(id)||id<1)return json(response,400,{error:'Invalid order'});
  const order=await customerOrder(id,user.id);
  if(order.payment_method!=='card'||order.payment_provider!=='stripe'||!/^pi_[a-zA-Z0-9]+$/.test(order.provider_payment_id || ''))return json(response,409,{error:'No card payment is ready for confirmation.'});
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{timeout:8000,maxNetworkRetries:0});
  const intent=await stripe.paymentIntents.retrieve(order.provider_payment_id);
  const result=await reconcileCardIntent({db,stripe,order,intent});
  return json(response,200,result);
 } catch(error) {
  securityLog('card_completion_failed',error);
  return json(response,[400,401,403,404,409,429,503].includes(error.status)?error.status:503,{error:error.status?error.message:'We could not confirm the payment yet. Check your order before trying to pay again.'});
 }
}
