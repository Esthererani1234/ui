import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {renderDeliveryPdf} from '../server/lib/deliveryPdf.js';
import {receiptInput,serialInput,deliveryInput,matchesMedia} from '../server/lib/documentInputs.js';
import {documentZip} from '../server/lib/documentZip.js';
import {archivedCustomerInvoice} from '../server/lib/customerDocument.js';
import {Readable} from 'node:stream';
import handler,{createOrderDocumentsHandler} from '../server/payments/order-documents.js';
import {unitText} from '../shared/deliveryDocs.js';
let db; const admin=randomUUID(),owner=randomUUID(),stamp='2026-11-16T17:00:00Z';
const snapshot=async(id=1)=>(await db.query('select public.order_document_state($1) as s',[id])).rows[0].s;
const write=async(a,v,s,user=admin,id=1)=>db.query('select public.order_document_action($1,$2,$3,$4,$5)',[id,user,a,JSON.stringify(v),JSON.stringify(s??await snapshot(id))]);
before(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table public.orders(id bigint primary key,user_id uuid,order_number text,created_at timestamptz,first_name text,last_name text,shipping_address jsonb,email text,payment_method text,payment_status text,status text,subtotal numeric,payment_surcharge numeric,insurance_amount numeric,shipping_amount numeric,total numeric,tracking_number text);
create table public.order_items(id bigint primary key,order_id bigint references public.orders(id),product_name text,sku text,metal text,metal_weight_oz numeric,quantity integer,unit_price numeric,line_total numeric,pricing_snapshot jsonb);
create table public.admin_users(user_id uuid);create table public.order_risk_reviews(order_id bigint,decision text);
insert into public.admin_users values('${admin}');insert into orders values(1,'${owner}','TEST-001',now(),'Example','Recipient','{"address_line_1":"123 Example Street","city":"New York","state":"NY","postal_code":"10001"}','test@example.test','wire','paid','processing',3200,0,0,0,3200,null);insert into orders select 2,user_id,'TEST-002',created_at,first_name,last_name,shipping_address,email,payment_method,'unpaid','awaiting_payment',subtotal,0,0,0,total,null from orders;
insert into order_items values(11,1,'Gold bar in assay','TEST-BAR','gold',1,2,1500,3000,'{"purity":".9999"}'),(12,1,'Silver coin','TEST-COIN','silver',1,1,200,200,'{}'),(21,2,'Gold bar','TEST','gold',1,1,1500,1500,'{}');insert into order_risk_reviews values(1,'approved'),(2,'pending');`);await db.exec(await readFile(new URL('../supabase/migrations/20261116173317_order_documents_delivery.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261116174123_restore_order_item_embedding.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
test('no client grants on documents/serials/logs, no client RPC execution, private media bucket',async()=>{
 for(const role of ['anon','authenticated'])for(const name of ['order_unit_tags','order_delivery_info','order_issued_documents','order_delivery_log'])for(const priv of ['SELECT','UPDATE','INSERT','DELETE','TRUNCATE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) v',[role,name,priv])).rows[0].v,false);
 for(const role of ['anon','authenticated'])for(const fn of ['order_document_state(bigint)','order_document_action(bigint,uuid,text,jsonb,jsonb)'])assert.equal((await db.query("select has_function_privilege($1,$2,'execute') v",[role,fn])).rows[0].v,false);
 assert.equal((await db.query("select public from storage.buckets where id='delivery-evidence'")).rows[0].public,false);
});
test('two units, uniqueness, ownership, signature, historical PDF bytes and print layout',async()=>{
 const raw=await snapshot();const files=[];async function pdf(s,kind,receipt){const id=randomUUID(),bytes=await renderDeliveryPdf(s,kind,id,stamp,receipt);assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);files.push([kind+'-'+files.length+'.pdf',bytes]);return {id,kind,pdf:bytes.toString('base64'),receipt}}
 await pdf(raw,'ack');await pdf(raw,'invoice');
 const t={line:11,unit:1,serial:'G-100',manufacturer:'Sample mint',assay:'CERT-10'};await assert.rejects(write('serial',t,raw,owner),e=>e.code==='42501');await write('serial',t,raw);
 await assert.rejects(write('serial',{...t,unit:2},raw),e=>e.code==='40001');await write('serial',{...t,unit:2,serial:'G-101'});
 await assert.rejects(write('serial',{...t,line:21,serial:'g-100'},null,admin,2),e=>e.code==='23505');
 await assert.rejects(write('serial',{...t,line:21}),e=>e.code==='22023');
 await assert.rejects(write('serial',{...t,unit:3}),e=>e.code==='22023');
 const delivery={method:'Personal Delivery',status:'Delivered',actual:stamp,recipient:'Example Recipient',representative:'Store representative'};
 await assert.rejects(write('delivery',delivery,null,admin,2),e=>e.code==='P3002');await write('delivery',{...delivery,status:'Preparing'});
 const s=await snapshot();await pdf(s,'packing');await pdf(s,'ack');const invoice=await pdf(s,'invoice');await write('owner_invoice',invoice,s,owner);
 const receipt=receiptInput({name:'Example Recipient',condition:'Intact',confirmed:true,idChecked:true,strokes:[[[0,.8],[.12,.15],[.22,.7],[.5,.35],[.75,.5]]]});
 const signed=await pdf(s,'signed',receipt);
 await assert.rejects(write('owner_invoice',signed,s,owner),e=>e.code==='42501');await write('issue',signed,s);
 await assert.rejects(write('serial',t),e=>e.code==='P3001');await write('delivery',delivery);
 const stored=(await db.query('select pdf,snapshot from order_issued_documents where id=$1',[signed.id])).rows[0];assert.deepEqual(stored.snapshot.receipt,receipt);assert.equal(stored.pdf,signed.pdf);assert.equal(stored.snapshot.delivery.status,'Preparing');
 assert.equal((await snapshot()).order.status,'processing');assert.equal((await snapshot()).order.payment_status,'paid');
 if(process.env.DOCUMENT_QA_DIR){await mkdir(process.env.DOCUMENT_QA_DIR,{recursive:true});for(const [n,b] of files)await writeFile(process.env.DOCUMENT_QA_DIR+'/'+n,b);await writeFile(process.env.DOCUMENT_QA_DIR+'/all.zip',documentZip(files))}
});
test('strict inputs and conditional unit fields',()=>{assert.throws(()=>serialInput({line:1,unit:1,serial:'A',total:3}));assert.throws(()=>receiptInput({confirmed:true}));assert.throws(()=>deliveryInput({method:'Shipping',status:'Delivered'}));assert.equal(unitText({assay:'ABC'}),'Assay: ABC');assert.equal(matchesMedia(Buffer.from('fake png'),'image/png'),false)});
test('unauthenticated HTTP requests denied before database/document access',async()=>{const res={status(n){this.code=n;return this},setHeader(){return this},end(){}};await handler({method:'POST',headers:{}},res);assert.equal(res.code,401)});
test('HTTP document issuance and archive, invoice reuse, ZIP, private media upload and evidence lookup',async()=>{
 const media=new Map(),signs=[];
 const api={
  rpc:async(n,p)=>{try{return {data:n==='order_document_state'?await snapshot(p.p_order):await write(p.p_action,p.p_data,p.p_expected,p.p_actor,p.p_order)}}catch(error){return {error}}},
  from:t=>{assert.ok(['order_delivery_log','order_issued_documents'].includes(t));let cols,order='',limit='',where=[],values=[];
   const q={select:c=>(cols=c.split(',').join(','),q),eq:(k,v)=>(values.push(v),where.push(k+'=$'+values.length),q),order:(k,opts)=>(order=' order by '+k+(opts.ascending?' asc':' desc'),q),limit:n=>(limit=' limit '+Number(n),q),
    async run(single){const {rows}=await db.query('select '+cols+' from '+t+(where.length?' where '+where.join(' and '):'')+order+limit,values);return {data:single?(rows[0]||null):rows}},
    maybeSingle:()=>q.run(true),single:()=>q.run(true),then:(ok,no)=>q.run(false).then(ok,no)};return q},
  storage:{from:b=>{assert.equal(b,'delivery-evidence');return {createSignedUploadUrl:async(k,o)=>{assert.equal(o.upsert,false);return {data:{token:'fixture-upload'}}},download:async k=>({data:media.get(k)}),createSignedUrl:async(k,ttl)=>{signs.push([k,ttl]);return {data:{signedUrl:'https://example.test/private-test'}}}}}}
 };
 const h=createOrderDocumentsHandler({database:()=>api,authenticate:async()=>({id:admin}),limit:async()=>{}});
 async function send(action,data,revision,order=2){const req=Readable.from([Buffer.from(JSON.stringify({order,action,data,revision}))]);req.method='POST';const res={headers:{},status(n){this.code=n;return this},setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},end(body){this.body=this.headers['content-type'].includes('json')?JSON.parse(body):body}};await h(req,res);return res}
 const {body:{revision}}=await send('load');const issued=await send('issue',{kind:'invoice'},revision);assert.equal(issued.code,200);
 const {body:{docs}}=await send('load');const saved=await send('archive',{id:docs[0].id});assert.deepEqual(saved.body,issued.body);assert.equal((await send('archive',{id:docs[0].id},undefined,1)).code,404);
 assert.deepEqual(await archivedCustomerInvoice(api,2,owner),issued.body);
 assert.equal((await send('issue',{kind:'signed',receipt:{name:'Test',confirmed:true,idChecked:false,condition:'Intact',strokes:[[[0,0],[1,1]]]}},revision)).code,409);
 const all=await send('issue',{kind:'all'},revision);assert.equal(all.headers['content-type'],'application/zip');assert.equal(all.body.readUInt32LE(0),0x04034b50);
 const bytes=await readFile(new URL('../server/assets/document-logo.png',import.meta.url));const metadata={size:bytes.length,type:'image/png'};
 const ticket=await send('upload',metadata,revision);assert.equal(ticket.code,200);const key=ticket.body.key;assert.equal(ticket.body.token,'fixture-upload');
 media.set(key,new Blob([Buffer.alloc(bytes.length)]));assert.equal((await send('attach',{...metadata,key},revision)).code,400);
 media.set(key,new Blob([bytes]));assert.equal((await send('attach',{...metadata,key},revision)).code,200);const log=(await send('load')).body.logs.find(l=>l.action==='evidence');
 assert.equal((await send('view',{id:log.id},revision)).code,200);assert.deepEqual(signs,[[key,60]]);
});

test('order rows have a direct item relation and no competing serial-table join',async()=>{
 const {rows}=await db.query(`select
    exists(select 1 from pg_constraint where contype='f'
      and conrelid='order_items'::regclass and confrelid='orders'::regclass) as direct,
    exists(select 1 from pg_constraint pk
      join pg_constraint a on a.contype='f' and a.conrelid=pk.conrelid and a.confrelid='orders'::regclass and pk.conkey @> a.conkey
      join pg_constraint b on b.contype='f' and b.conrelid=pk.conrelid and b.confrelid='order_items'::regclass and pk.conkey @> b.conkey
      where pk.contype='p') as competing_bridge`);
 assert.deepEqual(rows,[{direct:true,competing_bridge:false}]);
});
