import {authenticateCustomer,json,readJson,service} from '../../server/lib/payments.js';
import {rateLimit,requestHash,securityLog,strictObject} from '../../server/lib/security.js';
import {locationCsv} from '../../server/tax/locationExport.js';
import {dayNow} from '../../server/tax/admin.js';
import {previewCheckout,previewStreetOrder} from '../../server/tax/preview.js';
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
  if(req.method==='GET' && process.env.VERCEL_ENV==='preview'){
    if(req.query.format==='locations'){
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename="local-tax-locations.csv"');
      return res.status(200).end(locationCsv());
    }
    return json(res,200,await previewCheckout(req.query.state,Number(req.query.cents),req.query.place));
  }
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  try{
    const payload=await readJson(req);
    if(payload?.mode==='street_order' && process.env.VERCEL_ENV==='preview'){
      const body=strictObject(payload,['mode','address','cents']);
      if(!previewAddressAllowed(req))return json(res,429,{error:'Please wait a minute before checking another address.'});
      res.setHeader('Cache-Control','private, no-store');
      return json(res,200,await previewStreetOrder(body.address,body.cents,dayNow()));
    }
    const body=strictObject(payload,['quote_id','address','method','fulfillment','investment','mode','cart']);
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
