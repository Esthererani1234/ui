import Stripe from 'stripe';
import {json,service} from '../_lib/payments.js';
import {securityLog} from '../_lib/security.js';
import {reconcileCardIntent} from '../_lib/cardCapture.js';
export const maxDuration=60;
export default async function handler(request,response) {
 if(request.method!=='POST')return json(response,405,{error:'Method not allowed'});
 try {
  const token=request.headers['x-reconciliation-token'];
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return json(response,401,{error:'Unauthorized'});
  const db=service();
  const {data:valid,error:authError}=await db.rpc('check_payment_reconciliation_token',{p_token:token});
  if(authError)throw new Error('Job authentication unavailable');
  if(valid!==true)return json(response,401,{error:'Unauthorized'});
  const {data:jobs,error}=await db.rpc('claim_payment_reconciliations');
  if(error)throw new Error('Reconciliation unavailable');
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{timeout:8000,maxNetworkRetries:0});
  const outcomes=await Promise.all((jobs||[]).map(async job=>{
   let failure=null;
   try {
    const {data:order,error:orderError}=await db.from('orders').select('id,user_id,total,payment_provider,provider_payment_id,payment_method,payment_status,status,price_locked_until').eq('id',job.order_id).single();
    if(orderError||!order)throw new Error('Order unavailable');
    const intent=await stripe.paymentIntents.retrieve(order.provider_payment_id);
    await reconcileCardIntent({db,stripe,order,intent});
   } catch(error) {failure='reconciliation_failed';securityLog('payment_reconciliation_failed',error);}
   const {error:finishError}=await db.rpc('finish_payment_reconciliation',{p_order_id:job.order_id,p_lease_id:job.lease_id,p_error:failure});
   if(finishError)securityLog('payment_reconciliation_record_failed',finishError);
   return failure || finishError ? 'failed' : 'checked';
  }));
  return json(response,200,{checked:outcomes.filter(x=>x==='checked').length,failed:outcomes.filter(x=>x==='failed').length});
 }catch(error){securityLog('payment_reconciliation_unavailable',error);return json(response,503,{error:'Reconciliation temporarily unavailable'});}
}
