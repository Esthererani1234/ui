import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { checkSession, hashSubject, rateLimit, readObject, safeLog } from "../_shared/security.ts";

const allowed = (origin: string) => ["https://goldonthespot.com","https://www.goldonthespot.com","http://localhost:5173"].includes(origin);
const headers = (req: Request) => ({...(allowed(req.headers.get('origin') || '') ? {'access-control-allow-origin':req.headers.get('origin')!}:{}),'access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'POST, OPTIONS','cache-control':'no-store','vary':'Origin','content-type':'application/json'});
const respond = (req:Request,body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:headers(req)});
const fail = (message:string,status=400) => {throw Object.assign(new Error(message),{status});};
const key = (modern:string,legacy:string) => Deno.env.get(modern) ? JSON.parse(Deno.env.get(modern)!).default : Deno.env.get(legacy) || '';
const uuid = (value:unknown) => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function fields(body:Record<string,unknown>,names:string[]) {if(Object.keys(body).some(k=>!names.includes(k)))fail('Request contains invalid fields.');}
function text(value:unknown,min:number,max:number,label:string) {
 if(typeof value!=='string' || value.trim().length<min || value.trim().length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(`Check ${label}.`);
 return (value as string).trim();
}
Deno.serve(async(req:Request)=>{
 if(!allowed(req.headers.get('origin') || ''))return respond(req,{error:'Not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=='POST')return respond(req,{error:'Not allowed'},405);
 try {
  const body=await readObject(req,24000);
  if(!['create','mine','list','update'].includes(body.action))fail('Invalid sell request action.');
  const db=createClient(Deno.env.get('SUPABASE_URL') || '',key('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=req.headers.get('authorization') || '';
  if(!auth.startsWith('Bearer '))fail('Sign in to your Selling Centre to continue.',401);
  const {data:{user},error:authError}=await db.auth.getUser(auth.slice(7));
  if(authError || !user)fail('Sign in again to continue.',401);
  const {data:membership,error:membershipError}=await db.from('admin_users').select('user_id').eq('user_id',user!.id).maybeSingle();
  if(membershipError)throw membershipError;
  let claims:Record<string,unknown>={};
  try{const segment=auth.split('.')[1].replaceAll('-','+').replaceAll('_','/');claims=JSON.parse(atob(segment.padEnd(Math.ceil(segment.length/4)*4,'=')));}catch{fail('Sign in again to continue.',401);}
  if(membership && claims.aal!=='aal2')fail('Administrator two-factor verification required.',403);
  await checkSession(db,user!.id,String(claims.session_id || ''),!membership);
  if(body.action==='mine') {
   fields(body,['action','offset']);
   if(!Number.isSafeInteger(body.offset) || body.offset<0 || body.offset>100000)fail('Invalid page.');
   await rateLimit(db,'sell_customer_read',user!.id,60,600);
   const {data,error}=await db.from('sell_requests').select('id,reference,name,message,status,created_at,updated_at').eq('user_id',user!.id).order('created_at',{ascending:false}).order('id').range(body.offset,body.offset+49);
   if(error)throw error;
   return respond(req,{requests:data,has_more:data.length===50});
  }
  if(body.action==='create') {
   fields(body,['action','request_id','name','email','phone','message','website']);
   if(!uuid(body.request_id))fail('Refresh the form and try again.');
   if(body.website !== '')fail('The request could not be submitted.');
   const name=text(body.name,2,120,'your name'),email=text(user!.email,3,254,'your account email').toLowerCase(),phone=text(body.phone,7,30,'your phone number'),message=text(body.message,10,5000,'your item description');
   if(!user!.email_confirmed_at)fail('Verify your account email before opening a selling case.',403);
   if(body.email!==undefined && body.email!==email)fail('Use your signed-in account email.');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid email address.');
   if(!/^\+?[0-9().\s-]+$/.test(phone) || phone.replace(/\D/g,'').length<7 || phone.replace(/\D/g,'').length>15)fail('Enter a valid phone number.');
   // Email and global budgets remain effective even if a caller varies forwarded IP headers.
   const ip=(req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0,100);
   await rateLimit(db,'sell_ip',await hashSubject(ip),10,3600);
   await rateLimit(db,'sell_account',user!.id,3,3600);
   await rateLimit(db,'sell_email',await hashSubject(email),3,3600);
   await rateLimit(db,'sell_global','all',100,3600);
   const {data,error}=await db.rpc('submit_sell_request',{p_user_id:user!.id,p_request_id:body.request_id,p_name:name,p_email:email,p_phone:phone,p_message:message});
   if(error){if(error.code==='P2003')fail('This form reference was already used. Start a new request.',409);throw error;}
   return respond(req,data);
  }
  if(!membership || claims.aal!=='aal2')fail('Administrator two-factor verification required.',403);
  await rateLimit(db,'sell_admin',user!.id,60,600);
  if(body.action==='list') {
   fields(body,['action','offset']);
   if(!Number.isSafeInteger(body.offset) || body.offset<0 || body.offset>100000)fail('Invalid page.');
   const {data,error}=await db.from('sell_requests').select('id,reference,name,email,phone,message,status,internal_notes,version,created_at,updated_at').order('created_at',{ascending:false}).order('id').range(body.offset,body.offset+49);
   if(error)throw error;
   return respond(req,{requests:data,has_more:data.length===50});
  }
  fields(body,['action','id','version','status','internal_notes']);
  if(!uuid(body.id) || !Number.isSafeInteger(body.version) || body.version<1)fail('Refresh the request before saving.');
  if(!['new','reviewing','contacted','quoted','closed'].includes(body.status))fail('Choose a valid status.');
  const notes=text(body.internal_notes,0,5000,'your notes');
  const {data,error}=await db.rpc('update_sell_request',{p_actor:user!.id,p_id:body.id,p_version:body.version,p_status:body.status,p_notes:notes});
  if(error){if(error.code==='P2003')fail('This request changed. Refresh before saving; your draft is kept.',409);if(error.code==='P2002')fail('Request not found.',404);throw error;}
  return respond(req,{request:data});
 } catch(error) {
  safeLog('sell_request_error',error);
  const e=error as {status?:number,message?:string};
  return respond(req,{error:e.status && e.status<500?e.message:'The request could not be completed. Please try again.'},e.status || 500);
 }
});
