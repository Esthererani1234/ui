import crypto from "node:crypto";
export function strictObject(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)))
    throw Object.assign(new Error("Request contains invalid fields."), { status:400 });
  return value;
}
export function securityLog(event,error) {
  const code=error?.code || error?.type;
  console.error(event,{code:typeof code === "string" && /^[a-z0-9_]{1,60}$/i.test(code)?code:"internal_error"});
}
export async function rateLimit(db,scope,subject,limit,seconds) {
  const {data,error}=await db.rpc("consume_security_rate_limit",{p_scope:scope,p_subject:subject,p_limit:limit,p_seconds:seconds});
  if(error || !Number.isInteger(data)) throw Object.assign(new Error("Security checks are temporarily unavailable."),{status:503});
  if(data>0) throw Object.assign(new Error(`Too many requests. Try again in ${data} seconds.`),{status:429,retryAfter:data});
}
export const requestHash=value=>crypto.createHash("sha256").update(value).digest("hex");
export function stripeState(type,object) {
  if (["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(type) && object.payment_status==="paid") return ["paid","paid"];
  if (type==="payment_intent.succeeded") return ["paid","paid"];
  if (["checkout.session.async_payment_failed","payment_intent.payment_failed"].includes(type)) return ["failed","failed"];
  if (["checkout.session.expired","payment_intent.canceled"].includes(type)) return ["expired","expired"];
  if (type==="charge.refunded" && object.refunded===true) return ["refunded","refunded"];
  if (type==="charge.dispute.created") return ["disputed","disputed"];
  return null;
}
export function stripeMatchesOrder(intent,order) {
  return intent.currency==="usd" && Number.isSafeInteger(intent.amount) && intent.amount>0
    && intent.amount===Math.round(Number(order.total)*100)
    && intent.metadata?.order_id===String(order.id) && intent.metadata?.user_id===order.user_id;
}
