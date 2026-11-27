import {service,json} from '../../server/lib/payments.js';
import {calculateAdminOrder} from '../../server/tax/adminOrderReport.js';
import {securityLog} from '../../server/lib/security.js';

export const maxDuration=60;
async function rpc(db,name,args){
  const {data,error}=await db.rpc(name,args);
  if(error)throw Error('Tax report database unavailable');
  return data;
}
export async function processTaxReports(db,calculate=calculateAdminOrder){
  const jobs=await rpc(db,'claim_new_order_tax_reports');
  const completed=await Promise.all(jobs.map(async({order_id:p_order,lease:p_lease})=>{
    let result,retry=false;
    try{
      const inputs=await rpc(db,'new_order_tax_inputs',{p_order,p_lease});
      result=await calculate(inputs);
      retry=result.retryable===true;
      delete result.retryable;
    }catch{
      result={status:'review',reason:'The calculation service will retry this order.'};retry=true;
    }
    return rpc(db,'finish_new_order_tax_report',{p_order,p_lease,p_result:result,p_retry:retry});
  }));
  return completed.filter(Boolean).length;
}
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const token=req.headers['x-order-tax-token'];
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return json(res,401,{error:'Unauthorized'});
  try{
    const db=service();
    if(await rpc(db,'valid_order_tax_worker_token',{p_token:token})!==true)return json(res,401,{error:'Unauthorized'});
    return json(res,200,{checked:await processTaxReports(db)});
  }catch(error){securityLog('order_tax_report_failed',error);return json(res,503,{error:'Order tax reporting unavailable'});}
}
