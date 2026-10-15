import Stripe from "stripe";
import { json, readRaw, applyPaymentEvent, service } from "../_lib/payments.js";
import { securityLog, stripeState, stripeMatchesOrder } from "../_lib/security.js";
export const config = { api: { bodyParser: false } };
export default async function handler(request,response) {
  if(request.method!=="POST") return json(response,405,{error:"Method not allowed"});
  if(!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return json(response,503,{error:"Payment notifications unavailable"});
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try { event=stripe.webhooks.constructEvent(await readRaw(request),request.headers["stripe-signature"],process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return json(response,400,{error:"Invalid webhook"}); }
  try {
    const object=event.data.object;
    const state=stripeState(event.type,object);
    if(!state) return json(response,200,{received:true,ignored:true});
    const intentId=object.object==="payment_intent" ? object.id : typeof object.payment_intent==="string" ? object.payment_intent : object.payment_intent?.id;
    if(!intentId) return json(response,200,{received:true,ignored:true});
    const intent=await stripe.paymentIntents.retrieve(intentId);
    const orderId=Number(intent.metadata?.order_id);
    if(!Number.isSafeInteger(orderId) || orderId<1) return json(response,200,{received:true,ignored:true});
    const {data:order,error}=await service().from("orders").select("id,user_id,total,payment_provider,provider_payment_id").eq("id",orderId).maybeSingle();
    if(error) throw error;
    if(!order || !stripeMatchesOrder(intent,order)) throw new Error("Payment reconciliation mismatch");
    let providerId=intent.id;
    // Existing hosted sessions are supported alongside embedded PaymentIntents.
    if(order.provider_payment_id?.startsWith("cs_")) {
      const session=await stripe.checkout.sessions.retrieve(order.provider_payment_id);
      if(session.payment_intent!==intent.id || session.amount_total!==intent.amount || session.currency!=="usd") throw new Error("Checkout reconciliation mismatch");
      providerId=session.id;
    }
    if(order.payment_provider!=="stripe" || order.provider_payment_id!==providerId) throw new Error("Payment reference not yet reconciled");
    // A delayed failure callback must not override a subsequently successful intent.
    const currentState=intent.status==="succeeded" && ["failed","expired"].includes(state[0]) ? ["paid","paid"] : state;
    if(currentState[0]==="paid" && (intent.status!=="succeeded" || intent.amount_received!==intent.amount)) throw new Error("Payment not settled");
    const fresh=await applyPaymentEvent("stripe",event.id,orderId,event.type,providerId,currentState,object);
    return json(response,200,{received:true,duplicate:!fresh});
  } catch(error) {
    securityLog("stripe_webhook_failed",error);
    // Stripe retries transient failures. Failed work is never marked processed.
    return json(response,500,{error:"Payment notification could not be processed"});
  }
}
