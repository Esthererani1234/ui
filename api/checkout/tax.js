import {authenticateCustomer,json,readJson,service} from '../../server/lib/payments.js';
import {rateLimit,securityLog,strictObject} from '../../server/lib/security.js';
import {previewExample} from '../../server/tax/preview.js';
import {reviewQuote} from '../../server/tax/quote.js';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
  if(req.method==='GET' && process.env.VERCEL_ENV==='preview')return json(res,200,previewExample(req.query.state,Number(req.query.cents)));
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  try{
    const {user}=await authenticateCustomer(req,{requireSms:true}),db=service();
    await rateLimit(db,'tax_quote',user.id,90,600);
    const body=strictObject(await readJson(req),['quote_id','address','method','fulfillment','investment','mode','cart']);
    return json(res,200,await reviewQuote(db,user.id,body));
  }catch(e){securityLog('tax_quote_failed',e);return json(res,e.status||503,{error:e.status?e.message:'Tax verification is temporarily unavailable.',remaining_cents:e.remaining_cents});}
}
