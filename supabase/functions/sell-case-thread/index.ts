import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.110.6';
import { checkSession, hashSubject, rateLimit, readObject, safeLog } from '../_shared/security.ts';

const bucket='selling-case-photos';
const allowed=(req:Request)=>['https://goldonthespot.com','https://www.goldonthespot.com','http://localhost:5173'].includes(req.headers.get('origin')||'');
const headers=(req:Request)=>({'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(allowed(req)?{'access-control-allow-origin':req.headers.get('origin')!}:{}),'access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS'});
const fail=(message:string,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function decodeCasePhoto(value:unknown) {
 if(typeof value!=='string'||value.length>1398104||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))fail('Choose a JPEG, PNG, or WebP photo up to 1 MB.');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(value as string),c=>c.charCodeAt(0));}catch{fail('The photo could not be read.');}
 if(bytes!.length<12||bytes!.length>1048576)fail('Choose a photo up to 1 MB.');
 const b=bytes!;
 if(b[0]===255&&b[1]===216&&b[2]===255)return {bytes:b,mime:'image/jpeg',extension:'jpg'};
 if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return {bytes:b,mime:'image/png',extension:'png'};
 if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return {bytes:b,mime:'image/webp',extension:'webp'};
 fail('Only JPEG, PNG, and WebP photos are accepted.');
}
Deno.serve(async(req:Request)=>{
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(req)});
 if(!allowed(req))return respond({error:'Not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=='POST')return respond({error:'Not allowed'},405);
 try {
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))fail('Sign in to view your selling case.',401);
  const secrets=Deno.env.get('SUPABASE_SECRET_KEYS');
  const db=createClient(Deno.env.get('SUPABASE_URL')||'',secrets?JSON.parse(secrets).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await db.auth.getUser(auth.slice(7));
  if(authError||!user)fail('Sign in again to continue.',401);
  const {data:admin,error:adminError}=await db.from('admin_users').select('user_id').eq('user_id',user!.id).maybeSingle();if(adminError)throw adminError;
  let claims;try{const part=auth.split('.')[1].replaceAll('-','+').replaceAll('_','/');claims=JSON.parse(atob(part.padEnd(Math.ceil(part.length/4)*4,'=')));}catch{fail('Sign in again.',401);}
  if(admin&&claims.aal!=='aal2')fail('Administrator two-factor verification required.',403);
  await checkSession(db,user!.id,String(claims.session_id||''),!admin);
  const body=await readObject(req,1450000);
  if(!uuid(body.case_id)||!['read','send'].includes(body.action))fail('Invalid case request.');
  const permitted=body.action==='read'?['action','case_id','offset']:['action','case_id','request_id','message','photo'];
  if(Object.keys(body).some(key=>!permitted.includes(key)))fail('Request contains invalid fields.');
  let query=db.from('sell_requests').select('id').eq('id',body.case_id);
  if(!admin)query=query.eq('user_id',user!.id);
  const {data:caseRow,error:caseError}=await query.maybeSingle();if(caseError)throw caseError;if(!caseRow)fail('Case not found.',404);
  const present=async(row:Record<string,unknown>)=>{
   let photo_url=null;
   if(row.photo_path){const {data,error}=await db.storage.from(bucket).createSignedUrl(String(row.photo_path),300);if(error)throw error;photo_url=data.signedUrl;}
   return {id:row.id,body:row.body,sender_role:row.sender_role,created_at:row.created_at,photo_url};
  };
  if(body.action==='read'){
   if(!Number.isSafeInteger(body.offset)||body.offset<0||body.offset>200)fail('Invalid page.');
   await rateLimit(db,'sell_thread_read',user!.id,120,600);
   const {data,error}=await db.from('sell_case_messages').select('id,body,sender_role,created_at,photo_path').eq('case_id',body.case_id).order('created_at').order('id').range(body.offset,body.offset+49);if(error)throw error;
   return respond({messages:await Promise.all(data.map(present)),has_more:data.length===50});
  }
  if(!uuid(body.request_id)||typeof body.message!=='string'||body.message.trim().length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.message))fail('Enter a message up to 2,000 characters.');
  if(!body.message.trim()&&!body.photo)fail('Add a message or a photo.');
  const photo=body.photo==null?null:decodeCasePhoto(body.photo);
  await rateLimit(db,'sell_thread_send',user!.id,30,3600);
  if(photo)await rateLimit(db,'sell_photo_upload',user!.id,12,3600);
  const hash=photo?await hashSubject(body.photo):null;
  const {data:previous,error:previousError}=await db.from('sell_case_messages').select('id,case_id,body,sender_role,created_at,photo_path,photo_hash').eq('sender_id',user!.id).eq('request_id',body.request_id).maybeSingle();if(previousError)throw previousError;
  if(previous){if(previous.case_id!==body.case_id||previous.body!==body.message.trim()||previous.photo_hash!==hash)fail('Request reference already used. Please retry with a new message.',409);return respond({message:await present(previous)});}
  const path=photo?`${body.case_id}/${crypto.randomUUID()}.${photo.extension}`:null;
  if(photo){const {error}=await db.storage.from(bucket).upload(path!,photo.bytes,{contentType:photo.mime,upsert:false,cacheControl:'0'});if(error)throw error;}
  const {data,error}=await db.rpc('append_sell_case_message',{p_actor:user!.id,p_case:body.case_id,p_request:body.request_id,p_body:body.message.trim(),p_photo_path:path,p_photo_hash:hash});
  // An uncertain RPC response may have committed: retain the object for safe retry/reconciliation.
  // Only a successful deduplicated response proves that a redundant upload can be removed.
  if(!error&&path&&data.photo_path!==path)await db.storage.from(bucket).remove([path]);
  if(error){if(path&&['P2002','P2003','P2006'].includes(error.code))await db.storage.from(bucket).remove([path]);if(error.code==='P2002')fail('Case not found.',404);if(error.code==='P2003')fail('Request reference already used.',409);if(error.code==='P2006')fail(error.message,400);throw error;}
  return respond({message:await present(data)});
 }catch(error){safeLog('sell_thread_error',error);const e=error as {status?:number,message?:string};return respond({error:e.status&&e.status<500?e.message:'The case could not be updated. Your draft is kept; please retry.'},e.status||500);}
});
