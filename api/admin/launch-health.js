import {json,requireAdmin,service} from '../_lib/payments.js';
import {rateLimit,securityLog} from '../_lib/security.js';
export default async function handler(request,response){
 if(request.method!=='GET')return json(response,405,{error:'Method not allowed'});
 try{
  const user=await requireAdmin(request),db=service();await rateLimit(db,'launch_health',user.id,30,600);
  const {data,error}=await db.rpc('get_launch_health');if(error)throw error;
  return json(response,200,data);
 }catch(error){securityLog('launch_health_failed',error);return json(response,[401,403,429,503].includes(error.status)?error.status:503,{error:error.status?error.message:'Launch checks are temporarily unavailable.'});}
}
