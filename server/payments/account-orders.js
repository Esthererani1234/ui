import {authenticateCustomer, customerReadClient, json} from '../lib/payments.js';
import {securityLog} from '../lib/security.js';

// Read under the caller's JWT and existing row policies, never the service role.
const fields = [
  'id,order_number,first_name,last_name,email,phone,status,payment_status,payment_method,payment_provider',
  'provider_checkout_url,payment_reference,payment_due_at,subtotal,payment_surcharge,shipping_amount,insurance_amount,total',
  'spot_snapshot,price_locked_until,shipping_address,customer_notes,tracking_number,created_at,updated_at',
  'order_items!order_items_order_id_fkey(id,product_id,product_name,sku,metal,metal_weight_oz,quantity,unit_price,line_total,product_image_url,product_category,product_slug,products!order_items_product_id_fkey(image_url,image_urls,slug,category))',
].join(',');
export function accountOrders({authenticate=authenticateCustomer,readClient=customerReadClient}={}) {
  return async function handler(req,res) {
    if(req.method!=='GET') return json(res,405,{error:'Method not allowed'});
    try {
      const {user,token}=await authenticate(req,{requireSms:true});
      const number=new URL(req.url,'https://goldonthespot.com').searchParams.get('order');
      if(number!==null && (!number.trim() || number.length>100)) return json(res,400,{error:'Invalid order number.'});
      let q=readClient(token).from('orders').select(fields).eq('user_id',user.id);
      if(number!==null) q=q.eq('order_number',number).limit(1);
      const {data,error}=await q.order('created_at',{ascending:false});
      if(error) throw error;
      return json(res,200,{orders:data});
    } catch(e) {
      securityLog('account_order_read',e);
      const status=[401,403,429].includes(e.status)?e.status:503;
      return json(res,status,{error:status===401?'Sign in again to view your orders.':status===403?'Verify your phone for this session to view your orders.':'Order history is temporarily unavailable. Please try again.'});
    }
  };
}
export default accountOrders();
