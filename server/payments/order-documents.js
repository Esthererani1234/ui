import {createHash,randomUUID} from 'node:crypto';
import {requireAdmin,service,json,readJson} from '../lib/payments.js';
import {rateLimit,securityLog} from '../lib/security.js';
import {renderDeliveryPdf} from '../lib/deliveryPdf.js';
import {bad,fields,integer,string,serialInput,deliveryInput,receiptInput,formats,matchesMedia} from '../lib/documentInputs.js';
import {documentZip} from '../lib/documentZip.js';
const bucket='delivery-evidence';
function checked(r){if(r.error)throw r.error;return r.data}
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
function send(res,b,name){res.status(200);res.setHeader('Content-Type','application/pdf');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition','inline; filename="'+name+'.pdf"');res.end(b)}
export function createOrderDocumentsHandler({authenticate=requireAdmin,database=service,limit=rateLimit}={}){
return async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 try{
 const user=await authenticate(req),db=database(),body=fields(await readJson(req,360000),['order','action','revision','data']),id=integer(body.order),action=body.action,v=body.data??{};
 await limit(db,'admin_order_documents',user.id,120,600);
 const state=checked(await db.rpc('order_document_state',{p_order:id}));if(!state)bad('Order not found.',404);
 const revision=createHash('sha256').update(JSON.stringify(state)).digest('hex');
 const write=async(a,data)=>{if(body.revision!==revision)bad('Order changed. Reload the details before continuing.',409);checked(await db.rpc('order_document_action',{p_order:id,p_actor:user.id,p_action:a,p_data:data,p_expected:state}))};
 if(action==='load'){
 const docs=checked(await db.from('order_issued_documents').select('id,kind,created_at').eq('order_id',id).order('created_at',{ascending:false}));
 const logs=checked(await db.from('order_delivery_log').select('id,action,created_at,actor,details').eq('order_id',id).order('id',{ascending:false}));
 return json(res,200,{state,revision,docs,logs});}
 if(action==='archive'){if(!uuid(v.id))bad();const doc=checked(await db.from('order_issued_documents').select('kind,pdf').eq('order_id',id).eq('id',v.id).maybeSingle());if(!doc)bad('Document not found.',404);return send(res,Buffer.from(doc.pdf,'base64'),doc.kind+'-'+v.id)}
 if(action==='serial'||action==='delivery'){await write(action,action==='serial'?serialInput(v):deliveryInput(v));return json(res,200,{saved:true})}
 const storage=db.storage.from(bucket);
 if(action==='upload'||action==='attach'){
 fields(v,action==='upload'?['type','size','line','unit']:['type','size','line','unit','key']);
 if(!Object.hasOwn(formats,v.type)||integer(v.size)>52428800)bad('Choose a supported image or video up to 50 MiB.');
 if(v.line!=null&&(!v.type.startsWith('image/')||!state.items.some(i=>i.id===v.line&&i.units.some(u=>u.unit===v.unit))))bad('Save a serial number before adding its photo.');
 if(action==='upload'){const key=id+'/'+randomUUID()+'.'+formats[v.type];const ticket=checked(await storage.createSignedUploadUrl(key,{upsert:false}));return json(res,200,{key,token:ticket.token})}
 const key=string(v.key,160,true);if(!key.startsWith(id+'/')||!uuid(key.slice(String(id).length+1).split('.')[0])||key!==id+'/'+key.split('/')[1].split('.')[0]+'.'+formats[v.type])bad();
 const blob=checked(await storage.download(key));if(blob.size!==v.size||!matchesMedia(Buffer.from(await blob.slice(0,32).arrayBuffer()),v.type))bad('File contents do not match the selected media type.');
 const unit=state.items.find(i=>i.id===v.line)?.units.find(u=>u.unit===v.unit);
 await write('evidence',{...v,serial:unit?.serial??null});return json(res,200,{saved:true})}
 if(action==='view'){const log=checked(await db.from('order_delivery_log').select('details').eq('id',integer(v.id)).eq('order_id',id).eq('action','evidence').single());return json(res,200,{url:checked(await storage.createSignedUrl(log.details.after.key,60)).signedUrl})}
 if(action!=='issue')bad();
 fields(v,['kind','receipt']);if(!['signed','invoice','packing','ack','all'].includes(v.kind))bad();if(body.revision!==revision)bad('Reload this order before issuing documents.',409);
 const stamp=new Date().toISOString(),parts=[];
 for(const kind of v.kind==='all'?['invoice','ack','packing']: [v.kind]){
 const receipt=kind==='signed'?receiptInput(v.receipt):null,docId=randomUUID();
 const bytes=await renderDeliveryPdf(state,kind,docId,stamp,receipt);
 await write('issue',{id:docId,kind,pdf:bytes.toString('base64'),receipt});parts.push(bytes)}
 if(v.kind==='all'){const signed=checked(await db.from('order_issued_documents').select('pdf').eq('order_id',id).eq('kind','signed').order('created_at',{ascending:false}).limit(1));if(signed.length)parts.push(Buffer.from(signed[0].pdf,'base64'));
 const names=['invoice','acknowledgment','packing-slip','signed-acknowledgment'];res.status(200);res.setHeader('Content-Type','application/zip');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition','attachment; filename="order-'+id+'.zip"');return res.end(documentZip(parts.map((bytes,i)=>[names[i]+'.pdf',bytes])))}
 return send(res,parts[0],v.kind+'-'+id);
 }catch(e){securityLog('admin_order_documents',e);const known={'23505':'Serial already assigned or document already saved.','40001':'Order changed. Reload the order and try again.',P3001:'Serial numbers are locked after dispatch, signature or cancellation.',P3002:'Confirmed payment and approved risk review are required.','22023':'Invalid order item or delivery details.'};const msg=known[e.code];return json(res,msg?409:e.status||500,{error:msg||(e.status?e.message:'Could not complete this document request.')})}
}
}
export default createOrderDocumentsHandler();
