import { service } from "../../server/lib/payments.js";
import { rateLimit, strictObject, securityLog } from "../../server/lib/security.js";
import { assertPayable, authenticateCustomer, customerOrder, json, readJson } from "../../server/lib/payments.js";
import { createQuote, refreshCardOrder } from "../../server/lib/quotes.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user } = await authenticateCustomer(request, { requireSms: true });
    await rateLimit(service(), "price_quote", user.id, 20, 600);
    const body = strictObject(await readJson(request), ['order_id', 'cart', 'promo_code', 'quote_id']);
    if (Object.hasOwn(body,'quote_id')) {
      if(Object.keys(body).length!==2 || typeof body.quote_id!=='string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.quote_id) || typeof body.promo_code!=='string' || (body.promo_code!=='' && !/^[A-Z0-9_-]{3,32}$/.test(body.promo_code))) return json(response,400,{error:'Invalid promo request.'});
      const {data,error}=await service().rpc('revise_checkout_promo',{p_user_id:user.id,p_quote_id:body.quote_id,p_code:body.promo_code});
      if(error?.code==='P2010') return json(response,409,{error:'This promo code is unavailable or does not apply to this order.'});
      if(error?.code==='P2011') return json(response,409,{error:'This price lock is no longer active. Refresh checkout to review current prices.'});
      if(error) throw error;
      return json(response,200,{...data,server_time_ms:Date.now()});
    }
    if (body.order_id != null) {
      const orderId = Number(body.order_id);
      if (!Number.isSafeInteger(orderId) || orderId < 1) return json(response, 400, { error: "Invalid order" });
      const order = await customerOrder(orderId, user.id);
      if (order.payment_method !== "card") return json(response, 409, { error: "Only card orders can be refreshed here." });
      if (["paid", "refunded", "disputed"].includes(order.payment_status)) {
        return json(response, 409, { error: "This order can no longer accept payment." });
      }
      if (order.tax_amount != null) {
        assertPayable(order,'card');
        return json(response,200,{order_id:order.id,order_number:order.order_number,first_name:order.first_name,
          last_name:order.last_name,phone:order.phone,shipping_address:order.shipping_address,line_items:order.order_items,
          subtotal:order.subtotal,shipping:order.shipping_amount,card_surcharge:order.payment_surcharge,
          tax_amount:order.tax_amount,card_total:order.total,expires_at:order.price_locked_until,server_time_ms:Date.now()});
      }
      return json(response, 200, { ...(await refreshCardOrder(order.id)), order_number: order.order_number, server_time_ms: Date.now() });
    }
    return json(response, 201, { ...(await createQuote(user.id, body.cart, body.promo_code)), server_time_ms: Date.now() });
  } catch (error) {
    securityLog("checkout quote failed", error);
    return json(response, error.status || 500, {
      error: error.status ? error.message : "A fresh market quote is temporarily unavailable. Please try again.",
    });
  }
}
