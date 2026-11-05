import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.110.6';
import {checkSession,hashSubject,rateLimit,readObject,safeLog} from '../_shared/security.ts';
const bucket='product-review-photos';
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
 try{
  const secrets=Deno.env.get('SUPABASE_SECRET_KEYS');
  const db=createClient(Deno.env.get('SUPABASE_URL')||'',secrets?JSON.parse(secrets).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await readObject(req,4250000),positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
  const present=async(row:any)=>({id:row.id,rating:row.rating,body:row.body,created_at:row.created_at,photos:await Promise.all((row.photo_paths||[]).map(async(path:string)=>{const {data,error}=await db.storage.from(bucket).createSignedUrl(path,300);if(error)throw error;return data.signedUrl;}))});
  if(body.action==='list'){
   if(Object.keys(body).some(k=>!['action','product_id','offset'].includes(k))||!positive(body.product_id)||!Number.isSafeInteger(body.offset)||body.offset<0||body.offset>10000)fail('Invalid review page.');
   await rateLimit(db,'review_read',await hashSubject((req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim()),120,600);
   const {data,error}=await db.from('product_reviews').select('id,rating,body,created_at,photo_paths').eq('product_id',body.product_id).order('created_at',{ascending:false}).order('id').range(body.offset,body.offset+19);if(error)throw error;
   return respond({reviews:await Promise.all(data.map(present)),has_more:data.length===20});
  }
  const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))fail('Sign in to review your purchase.',401);
  const {data:{user},error:authError}=await db.auth.getUser(auth.slice(7));if(authError||!user)fail('Sign in again.',401);
  let claims;try{const part=auth.split('.')[1].replaceAll('-','+').replaceAll('_','/');claims=JSON.parse(atob(part.padEnd(Math.ceil(part.length/4)*4,'=')));}catch{fail('Sign in again.',401);}
  await checkSession(db,user!.id,String(claims.session_id||''),true);
  await rateLimit(db,'review_account',user!.id,60,600);
  if(body.action==='mine'){
   if(Object.keys(body).some(k=>!['action','order_id'].includes(k))||!positive(body.order_id))fail('Invalid order.');
   const {data:order,error}=await db.from('orders').select('id').eq('id',body.order_id).eq('user_id',user!.id).maybeSingle();if(error)throw error;if(!order)fail('Order not found.',404);
   const {data:items,error:itemsError}=await db.from('order_items').select('id').eq('order_id',body.order_id);if(itemsError)throw itemsError;
   if(!items.length)return respond({reviewed:[]});
   const {data,error:reviewError}=await db.from('product_reviews').select('order_item_id').eq('user_id',user!.id).in('order_item_id',items.map((i:any)=>i.id));if(reviewError)throw reviewError;return respond({reviewed:data.map((r:any)=>r.order_item_id)});
  }
  if(body.action!=='submit'||Object.keys(body).some(k=>!['action','order_item_id','request_id','rating','message','photos','consent'].includes(k))||!positive(body.order_item_id)||!uuid(body.request_id)||!Number.isInteger(body.rating)||body.rating<1||body.rating>5||typeof body.message!=='string'||body.message.trim().length<20||body.message.trim().length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.message)||!Array.isArray(body.photos)||body.photos.length>3||body.consent!=='public-review-v1')fail('Choose a rating, write 20–2,000 characters, and agree to public sharing. Up to three images.');
  await rateLimit(db,'review_submit',user!.id,6,3600);
  const hash=await hashSubject(JSON.stringify([body.order_item_id,body.rating,body.message.trim(),body.photos,body.consent]));
  const {data:previous,error:previousError}=await db.from('product_reviews').select('id,order_item_id,payload_hash').eq('user_id',user!.id).eq('request_id',body.request_id).maybeSingle();if(previousError)throw previousError;
  if(previous){if(previous.order_item_id!==body.order_item_id||previous.payload_hash!==hash)fail('Review request already used.',409);return respond({ok:true,id:previous.id});}
  const {data:item,error:itemError}=await db.from('order_items').select('order_id').eq('id',body.order_item_id).maybeSingle();if(itemError)throw itemError;if(!item)fail('Order item not found.',404);
  const {data:order,error:orderError}=await db.from('orders').select('status,payment_status').eq('id',item.order_id).eq('user_id',user!.id).maybeSingle();if(orderError)throw orderError;if(!order)fail('Order item not found.',404);if(order.status!=='completed'||order.payment_status!=='paid')fail('Reviews open after payment and delivery.',403);
  const photos=body.photos.map(decodeCasePhoto),paths:string[]=[];
  for(const photo of photos){const path=`${user!.id}/${body.request_id}/${crypto.randomUUID()}.${photo!.extension}`;const {error}=await db.storage.from(bucket).upload(path,photo!.bytes,{contentType:photo!.mime,upsert:false,cacheControl:'0'});if(error){if(paths.length)await db.storage.from(bucket).remove(paths);throw error;}paths.push(path);}
  const {data,error}=await db.rpc('submit_product_review',{p_actor:user!.id,p_item:body.order_item_id,p_request:body.request_id,p_rating:body.rating,p_body:body.message.trim(),p_photos:paths,p_hash:hash,p_consent:body.consent});
  if(error){if(['P2002','P2003','P2006'].includes(error.code)){if(paths.length)await db.storage.from(bucket).remove(paths);fail(error.message,error.code==='P2002'?404:409);}throw error;}
  const unused=paths.filter(path=>!data.photo_paths.includes(path));if(unused.length)await db.storage.from(bucket).remove(unused);
  return respond({ok:true,id:data.id});
 }catch(error){safeLog('product_review_error',error);const e=error as {status?:number,message?:string};return respond({error:e.status&&e.status<500?e.message:'Reviews are temporarily unavailable. Please retry.'},e.status||500);}
});
