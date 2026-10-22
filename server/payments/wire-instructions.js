import { authenticateCustomer, customerOrder, json, service } from "../lib/payments.js";
import {rateLimit, securityLog} from "../lib/security.js";
import {wireOrderInstructions} from "../lib/wire.js";
export default async function handler(request,response) {
 if(request.method!=="GET")return json(response,405,{error:"Method not allowed"});
 try {
  const {user}=await authenticateCustomer(request,{requireSms:true});
  await rateLimit(service(),"wire_instructions_read",user.id,60,600);
  const id=Number(request.query.order_id);
  if(!Number.isSafeInteger(id)||id<1)return json(response,400,{error:"Invalid order"});
  const order=await customerOrder(id,user.id);
  return json(response,200,await wireOrderInstructions(order));
 } catch(error) {
  securityLog("wire_instructions_failed",error);
  return json(response,error.status||500,{error:error.status?error.message:"Wire instructions are temporarily unavailable"});
 }
}
