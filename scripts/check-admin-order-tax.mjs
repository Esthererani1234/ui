import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import states from '../shared/taxSources.json' with {type:'json'};
import {calculateAdminOrder} from '../server/tax/adminOrderReport.js';
import {processTaxReports} from '../api/operations/order-tax.js';
import {assess} from '../server/tax/engine.js';

const day='2026-11-24',review={approval:'approved',source:'https://example.invalid/fixture',version:1,valid_from:day,valid_until:day,verified_on:day};
const inputs={day,state:'NY',policy:{...review,state:'NY',collection:'collect',registration:'Registered',first_eligible_cent:100001,store_minimum:true,rounding:'combined',shipping_base:'full_if_taxable',fee_base:'proportional'},
  district:{...review,state:'NY',rates:[{level:'state',code:'NY',ppm:40000},{level:'city',code:'NYC',ppm:45000},{level:'district',code:'MCTD',ppm:3750}]},
  products:{1:{...review,catalog_sku:'silver',catalog_name:'Silver coin',catalog_weight:1,metal:'silver',form:'coin',treatment:'taxable'}},
  lines:[{id:1,sku:'silver',name:'Silver coin',weight:1,metal:'silver',quantity:1,gross:'59.41'}],subtotal:'59.41',shipping:'35.00',fee:'2.38',investment:null};
test('own engine calculates a historical assessment below the current store minimum and allocates it by jurisdiction',async()=>{
 const result=await calculateAdminOrder(inputs);
 assert.equal(result.status,'calculated');assert.equal(result.tax,859);assert.equal(result.taxable,5941);
 assert.equal(result.breakdown.reduce((n,r)=>n+r.cents,0),859);
 assert.throws(()=>assess({day,state:'NY',policy:inputs.policy,subtotal:5941}),/minimum/);
 assert.equal((await calculateAdminOrder({...inputs,subtotal:'2000.00'})).status,'review');
 assert.equal((await calculateAdminOrder({...inputs,district:null})).status,'review');
 assert.equal((await calculateAdminOrder({...inputs,insurance:1})).status,'review');
 assert.equal((await calculateAdminOrder({...inputs,products:{}})).status,'review');
});
test('report preserves zero, missing data and original recorded calculations independently',async()=>{
 const zero={...inputs,state:'OR',policy:{...inputs.policy,state:'OR',collection:'no_obligation',first_eligible_cent:0},district:{...inputs.district,state:'OR',rates:[]}};
 assert.equal((await calculateAdminOrder(zero)).tax,0);
 assert.equal((await calculateAdminOrder({saved:{tax:0,state:'OR',day}})).status,'recorded');
 assert.deepEqual(await calculateAdminOrder({review:'Missing policy',day}),{status:'review',reason:'Missing policy',day});
});
test('report covers all destinations, refund flags, local day boundaries, unknown tax, pagination and access control',async()=>{
 const db=new PGlite();const admin='00000000-0000-4000-8000-000000000001';
 try{
 await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create table public.admin_users(user_id uuid);create table private.tax_states(state text primary key,effective date,active_confirmed_on date,collect_from date,registration text,ny_dealer_confirmed_on date,ny_dealer_status text);
 create table public.orders(id bigint primary key,order_number text,user_id uuid,shipping_address jsonb,created_at timestamptz,paid_at timestamptz,payment_status text,subtotal numeric,total numeric,tax_amount numeric,shipping_amount numeric,payment_surcharge numeric,insurance_amount numeric,tax_assessment_id uuid);
 create table private.tax_assessments(id uuid,user_id uuid,result jsonb,address jsonb);create table public.products(id bigint,sku text,name text,metal text,metal_weight_oz numeric,is_active boolean);
 create table public.order_items(order_id bigint,product_id bigint,sku text,product_name text,metal text,metal_weight_oz numeric,quantity int,line_total numeric);
 create function private.tax_normalize_address(a jsonb) returns jsonb language sql as $$select a$$;
 create function private.tax_version(s text,k text,sub text,d date) returns jsonb language sql as $$select null::jsonb$$;`);
 await db.query('insert into admin_users values ($1)',[admin]);await db.query("insert into private.tax_states(state) select unnest($1::text[])",[states.map(s=>s.code)]);
 const sql=await readFile(new URL('../supabase/migrations/20261127051000_admin_order_tax_report.sql',import.meta.url),'utf8');await db.exec(sql);
 const period=async(state=null,before=null)=>(await db.query('select public.tax_admin_order_report($1,$2,$2,$3,$4) r',[admin,day,state,before])).rows[0].r;
 await assert.rejects(db.query("select public.tax_admin_order_report(null,$1,$1)",[day]),/Admin required/);
 assert.equal((await db.query("select has_function_privilege('authenticated','public.tax_admin_order_report(uuid,date,date,text,bigint)','EXECUTE') v")).rows[0].v,false);
 assert.equal((await period()).states.length,51);
 for(const s of states)assert.equal((await db.query('select private.tax_admin_state($1) s',[s.name])).rows[0].s,s.code);
 await db.exec(`insert into orders(id,user_id,order_number,shipping_address,created_at,paid_at,payment_status,subtotal,total,shipping_amount,payment_surcharge)
   select i,'00000000-0000-4000-8000-000000000001','TEST-'||i,'{"state":"NY"}','2026-11-24T13:00Z','2026-11-25T04:59:59Z','paid',31,32,1,0 from generate_series(1,27)i;
 update orders set payment_status='refunded' where id=1;
 update orders set shipping_address='{"state":"CA","fulfillment":"pickup"}' where id=2;
 insert into orders(id,shipping_address,paid_at,payment_status) values (100,'{}','2026-11-24T05:00:00Z','paid'),(101,'{"state":"WA"}','2026-11-25T05:00Z','paid'),(102,'{}',null,'refunded');
 update orders set tax_amount=0,tax_assessment_id='00000000-0000-4000-8000-000000000002' where id=3;
 insert into private.tax_assessments values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','{"state":"NY","total":3200,"subtotal":3100,"tax":0,"shipping":100,"fee":0,"taxable":0,"exempt":3100,"breakdown":[]}','{"state":"NY"}');`);
 const result=await period(),ny=result.states.find(s=>s.state==='NY');
 assert.equal(ny.orders,27);assert.equal(ny.refunded_orders,1);assert.equal(ny.calculated_tax,0);assert.equal(ny.needs_review,26);assert.equal(ny.missing_recorded,26);
 assert.equal(result.missing_payment_date,1);assert.equal(result.states.find(s=>s.state==='WA').orders,0);
 assert.equal(result.states.find(s=>s.state==='UNASSIGNED').orders,1);assert.equal(result.states.length,52);
 const first=await period('NY'),second=await period('NY',first.next);assert.equal(first.orders.length,25);assert.equal(second.orders.length,2);assert.equal(second.next,null);
 const read=async id=>(await db.query('select public.tax_admin_calculation_inputs($1,$2) r',[admin,id])).rows[0].r;
 assert.match((await read(1)).review,/No verified policy/);assert.equal((await read(3)).saved.tax,0);
 await db.exec('update orders set total=34 where id=3');assert.match((await read(3)).review,/reconciliation/);
 await db.exec("create or replace function private.tax_version(s text,k text,sub text,d date) returns jsonb language sql as $$select case when k='policy' then jsonb_build_object('approval','approved','verified_on',d,'valid_from',d,'valid_until',d) end$$");
 assert.match((await read(1)).review,/Nationwide/);
 // The forward-only worker is independent of customer checkout and settlement.
 await db.exec('create table private.tax_revision(revision bigint);insert into private.tax_revision values (1)');
 const forward=await readFile(new URL('../supabase/migrations/20261127051001_prospective_admin_tax.sql',import.meta.url),'utf8');
 await db.exec(forward.split('-- Scheduler authentication')[0]);
 await db.exec('select private.queue_new_order_reports()');
 assert.deepEqual((await db.query('select * from public.claim_new_order_tax_reports()')).rows,[]);
 await db.query("insert into orders(id,order_number,created_at,payment_status,shipping_address,subtotal,total) values(201,'FUTURE',clock_timestamp(),'unpaid',$1,50,50)",[{state:'NY'}]);
 const discover=()=>db.exec('select private.queue_new_order_reports()');
 const claim=async()=>(await db.query('select * from public.claim_new_order_tax_reports()')).rows;
 const finish=async(id,lease,result,retry)=>(await db.query('select public.finish_new_order_tax_report($1,$2,$3,$4) v',[id,lease,result,retry])).rows[0].v;
 await discover();await discover();const [job]=await claim();assert.equal(job.order_id,201);
 assert.deepEqual(await claim(),[]);await assert.rejects(db.query('select public.new_order_tax_inputs(201,null)'),/lease expired/);
 const data=(await db.query('select public.new_order_tax_inputs(201,$1) r',[job.lease])).rows[0].r;
 assert.match(data.review,/Nationwide/);
 assert.equal(await finish(201,job.lease,{status:'review',reason:data.review},false),true);
 await discover();assert.deepEqual(await claim(),[]);
 await db.exec('update private.tax_revision set revision=2');await discover();const [revised]=await claim();
 assert.equal(await finish(201,job.lease,{status:'calculated',tax:0},false),false);
 await assert.rejects(finish(201,revised.lease,{status:'review',tax:0},false),/Invalid tax report/);
 assert.equal(await finish(201,revised.lease,{status:'calculated',tax:444,taxable:5000,exempt:0,breakdown:[]},false),true);
 const report=async()=>(await db.query("select public.tax_admin_new_orders($1,current_date-2,current_date+2) r",[admin])).rows[0].r;
 assert.deepEqual((await report()).orders.map(o=>o.id),[201]);assert.equal((await report()).orders[0].result.tax,444);
 await db.exec("update orders set paid_at=now() where id=201");
 await discover();const [paid]=await claim();
 assert.equal(await finish(201,paid.lease,{status:'calculated',tax:444,taxable:5000,exempt:0,breakdown:[]},false),true);
 const summary=(await db.query("select public.tax_admin_order_report($1,current_date-2,current_date+2,'NY') r",[admin])).rows[0].r;
 assert.equal(summary.orders.find(o=>o.order_id===201).calculated_tax,444);
 assert.equal((await read(201)).report.tax,444);
 await db.exec('update orders set subtotal=51,total=51 where id=201');
 assert.equal((await report()).orders[0].result,null);await discover();const [changed]=await claim();
 await db.exec('update orders set subtotal=52,total=52 where id=201');
 assert.equal(await finish(201,changed.lease,{status:'calculated',tax:444},false),false);
 const [retry]=await claim();assert.equal(await finish(201,retry.lease,{status:'review',reason:'retry'},true),true);
 assert.deepEqual(await claim(),[]);
 await assert.rejects(db.query("select public.tax_admin_new_orders(null,current_date-1,current_date)"),/Admin required/);
 assert.equal((await db.query("select has_function_privilege('authenticated','public.new_order_tax_inputs(bigint,uuid)','execute') v")).rows[0].v,false);
 }finally{await db.close();}
});

test('the worker persists a distinct outcome for every new order across all 51 destinations',async()=>{
 const queued=states.map((s,i)=>({state:s.code,order_id:i+1,lease:'lease-'+i})),saved=new Map();
 const db={async rpc(method,args){
   if(method==='claim_new_order_tax_reports')return {data:queued.splice(0,4)};
   const {p_order,p_lease}=args;assert.equal(p_lease,'lease-'+(p_order-1));
   const state=states[p_order-1].code;
   if(method==='new_order_tax_inputs'){
     if(state==='NY')return {data:inputs};
     if(state==='OR')return {data:{...inputs,state,policy:{...inputs.policy,state,collection:'no_obligation'},district:{...inputs.district,state,rates:[]}}};
     return {data:{review:'Incomplete official evidence',day}};
   }
   assert.equal(method,'finish_new_order_tax_report');assert.equal(saved.has(p_order),false);
   assert.equal(args.p_retry,false);saved.set(p_order,args.p_result);return {data:true};
 }};
 while(queued.length)await processTaxReports(db);
 assert.equal(saved.size,51);
 for(const [id,result] of saved){
   const state=states[id-1].code;
   if(state==='NY')assert.equal(result.tax,859);
   else if(state==='OR')assert.equal(result.tax,0);
   else {assert.equal(result.status,'review');assert.equal(Object.hasOwn(result,'tax'),false);}
 }
});
