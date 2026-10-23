import {authenticateCustomer,customerOrder,service,json} from '../lib/payments.js';
import {rateLimit,securityLog} from '../lib/security.js';
import {createOrderInvoice} from '../lib/orderInvoice.js';
export default async function handler(req,res){
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
 try{
  const {user}=await authenticateCustomer(req,{requireSms:true});
  const id=Number(req.query.order_id);if(!Number.isSafeInteger(id)||id<1)return json(res,400,{error:'Invalid order'});
  const order=await customerOrder(id,user.id);
  await rateLimit(service(),'invoice_download',user.id,30,600);
  const {data:items,error}=await service().from('order_items').select('product_name,sku,quantity,unit_price,line_total').eq('order_id',id).order('id');if(error)throw error;
  const {data:dates,error:dateError}=await service().from('orders').select('created_at').eq('id',id).eq('user_id',user.id).single();if(dateError)throw dateError;
  const pdf=await createOrderInvoice({...order,created_at:dates.created_at},items||[]);
  res.status(200);res.setHeader('content-type','application/pdf');res.setHeader('cache-control','private, no-store');res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-disposition',`attachment; filename="invoice-${String(order.order_number).replace(/[^a-zA-Z0-9-]/g,'')}.pdf"`);
  res.end(Buffer.from(pdf));
 }catch(error){securityLog('invoice_failed',error);return json(res,error.status||500,{error:error.status?error.message:'Invoice is temporarily unavailable. Please try again.'});}
}
