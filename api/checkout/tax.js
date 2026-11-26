import {authenticateCustomer,json,readJson,service} from '../../server/lib/payments.js';
import {rateLimit,requestHash,securityLog,strictObject} from '../../server/lib/security.js';
import {previewCheckout} from '../../server/tax/preview.js';
import {reviewQuote} from '../../server/tax/quote.js';
import {correctDeliveryAddress} from '../../server/address/correct.js';

export const config={api:{bodyParser:false}};
const previewClients=new Map();
let windowStarted=0, previewRequests=0;
function previewAddressAllowed(req) {
  if(Date.now()-windowStarted>=60000){windowStarted=Date.now();previewRequests=0;previewClients.clear();}
  const key=requestHash(String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'preview'));
  const count=previewClients.get(key) || 0;
  if(count>=20 || previewRequests>=240)return false;
  previewClients.set(key,count+1);previewRequests++;return true;
}
export default async function handler(req,res){
  if(req.method==='GET' && process.env.VERCEL_ENV==='preview')return json(res,200,await previewCheckout(req.query.state,Number(req.query.cents),req.query.place));
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  try{
    const body=strictObject(await readJson(req),['quote_id','address','method','fulfillment','investment','mode','cart']);
    if(body.mode==='address' && process.env.VERCEL_ENV==='preview' && !req.headers.authorization){
      if(!previewAddressAllowed(req))return json(res,429,{error:'Please wait a minute before checking another address.'});
      return json(res,200,await correctDeliveryAddress(body.address,{postal:false}));
    }
    const {user}=await authenticateCustomer(req,{requireSms:body.mode!=='address'}),db=service();
    await rateLimit(db,body.mode==='address'?'delivery_address':'tax_quote',user.id,90,600);
    if(body.mode==='address')return json(res,200,await correctDeliveryAddress(body.address));
    return json(res,200,await reviewQuote(db,user.id,body));
  }catch(e){securityLog('tax_quote_failed',e);return json(res,e.status||503,{error:e.status?e.message:'Tax verification is temporarily unavailable.',code:e.code,remaining_cents:e.remaining_cents});}
}
