import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.6';
import { deliverOrderEmails } from '../_shared/orderEmailDelivery.js';
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
Deno.serve(async(request:Request)=>{
 if(request.method!=='POST') return reply(405,{error:'Method not allowed'});
 const token=request.headers.get('x-order-email-token') || '';
 if(!/^[a-f0-9]{64}$/.test(token)) return reply(401,{error:'Unauthorized'});
 try {
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:valid,error:authError}=await db.rpc('check_order_email_worker_token',{p_token:token});
  if(authError || valid!==true) return reply(401,{error:'Unauthorized'});
  const {data:settings,error}=await db.rpc('get_order_email_secret');
  if(error) throw error;
  return reply(200,await deliverOrderEmails(db,settings));
 } catch {console.error('order_email_worker_failed');return reply(500,{error:'Email delivery temporarily unavailable'});}
});
