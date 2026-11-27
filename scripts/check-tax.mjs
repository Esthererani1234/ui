import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assess,allocate,cents} from '../server/tax/engine.js';
import {washingtonResult,washingtonStreetCode} from '../server/tax/washington.js';
import {orderTotalCents} from '../server/tax/orderAmounts.js';
import {renderOrderEmail} from '../supabase/functions/_shared/orderEmail.js';
import {WIRE_AGREEMENT_VERSION} from '../supabase/functions/_shared/wireAgreement.js';
import {normalizeAddress} from '../server/tax/quote.js';
import states from '../shared/taxSources.json' with {type:'json'};
const day='2026-11-26';
const record={source:'https://www.nysenate.gov/legislation/laws/TAX/1115',approval:'approved',version:1,valid_from:'2026-01-01',valid_until:'2026-12-31',verified_on:day};
const product={...record,treatment:'eligible',form:'bar',metal:'gold',market_day:day,prior_business_day:'2026-11-25',market_observed_on:'2026-11-25',market_calendar_source:record.source,market_basis:'cash_close',market_unit_cents:200000,market_source:record.source};
const policy={...record,state:'NY',collection:'collect',registration:'Registered',ny_dealer_status:'registered',first_eligible_cent:100001,store_minimum:true,shipping_base:'full_if_taxable',fee_base:'full_if_taxable',rounding:'combined'};
const address={...record,state:'NY',rates:[{code:'NY',level:'state',ppm:40000},{code:'NYC',level:'city',ppm:45000},{code:'MCTD',level:'district',ppm:3750}]};
function input(n){return {day,state:'NY',address,policy,subtotal:n,shipping:0,fee:0,investment:true,lines:[{id:1,quantity:1,gross:n,classification:product}]};}
for(const s of states)test(s.code+' unreviewed jurisdiction blocks checkout',()=>{
  assert.ok(s.sources.length);assert.throws(()=>assess({...input(2000000),state:s.code,policy:null}),/tax review/);
});
for(const [subtotal,remaining] of [[99999,2],[100000,1],[75000,25001],[100001,0]])test('NY qualifying purchase '+subtotal,()=>{
  if(remaining)assert.throws(()=>assess(input(subtotal)),e=>e.remaining_cents===remaining);
  else assert.equal(assess(input(subtotal)).tax,0);
});
test('NY above premium cap is taxable even above the minimum',()=>{
 const q=input(230001);assert.equal(assess(q).tax,20413);assert.equal(assess(input(230000)).exempt,230000);
});
test('mixed merchandise, discount, charges and combined rounding reconcile',()=>{
 const q=input(300000);q.subtotal=299997;q.lines.push({id:2,quantity:1,gross:100000,classification:{...product,treatment:'taxable'}});q.shipping=321;q.fee=100;
 const r=assess(q);assert.equal(r.taxable,74999);assert.equal(r.exempt,224998);assert.equal(r.tax,6694);assert.equal(r.total,307112);assert.equal(r.breakdown.reduce((a,b)=>a+b.cents,0),r.tax);
});
const waRows=Buffer.from('601,699,O,4TH AVE E,WA,98501,1112,Q42026,3403,N,Thurston PTBA,\n6400,6498,E,LINDERSON WAY SW,WA,98501,6516,Q42026,3406,N,Thurston PTBA,\n');
const waExamples=[
  {place:'olympia',street:'4TH AVE E',number:601,code:'3403',local:'.035',total:'.100',zip4:'1112',tax:200000},
  {place:'tumwater',street:'LINDERSON WAY SW',number:6400,code:'3406',local:'.033',total:'.098',zip4:'6516',tax:196000},
];
for(const e of waExamples) test('WA delivery in '+e.place+' uses its Q4 rate within ZIP 98501',()=>{
  const destination={address_line_1:e.number+' '+e.street,city:e.place,state:'WA',postal_code:'98501'};
  const code=washingtonStreetCode(waRows,destination);
  const fixture=`<response loccode="${e.code}" localrate="${e.local}" rate="${e.total}" code="2"><addressline code="${e.code}" street="${e.street}" househigh="${e.number}" houselow="${e.number}" evenodd="${e.number%2?'O':'E'}" state="WA" zip="98501" plus4="${e.zip4}" period="Q42026"/><rate code="${e.code}" staterate=".065" localrate="${e.local}"/></response>`;
  const address=washingtonResult(fixture,day,destination,code);
  assert.equal(code,e.code);
  const q=input(2000000);q.address=address;q.state='WA';q.policy={...policy,state:'WA',first_eligible_cent:0};q.lines[0].classification={...product,treatment:'taxable'};
  assert.equal(assess(q).tax,e.tax);assert.equal(previewExample('WA',2000000,e.place).tax,e.tax);
  q.policy.collection='no_obligation';assert.equal(assess(q).status,'not_collected');
  for(const change of [['code="2"','code="1"'],['code="2"','code="5"'],['Q42026','Q32026'],['staterate=".065"','staterate=".05"']])assert.throws(()=>washingtonResult(fixture.replace(...change),day,destination,code));
  assert.throws(()=>washingtonResult(fixture,day,{...destination,postal_code:'98501-9999'},code));
  assert.throws(()=>washingtonStreetCode(waRows,{...destination,address_line_1:(e.number+1)+' '+e.street}));
  assert.throws(()=>washingtonStreetCode(Buffer.concat([waRows,Buffer.from(waRows.toString().replaceAll(e.code,'9999'))]),destination));
});
test('seller levies accrue separately and never increase the customer total',()=>{
 const q=input(140000);q.policy={...policy,seller_taxes:[{kind:'gross_receipts',base:'merchandise',code:'fixture',ppm:5000}]};
 const r=assess(q);assert.equal(r.total,140000);assert.equal(r.seller_taxes[0].cents,700);
});
test('NJ per coin fair market value cannot be pooled',()=>{
 const q=input(160000);q.state='NJ';q.address={...address,state:'NJ'};q.policy={...policy,state:'NJ',first_eligible_cent:0};
 q.lines[0]={...q.lines[0],quantity:2,classification:{...product,form:'coin',market_unit_cents:80000}};
 assert.equal(assess(q).taxable,160000);
});
test('inactive rules, outdated support, missing street, invalid money fail closed',()=>{
 const q=input(120000);q.policy={...policy,valid_until:'2026-11-25'};assert.throws(()=>assess(q));
 assert.throws(()=>normalizeAddress({postal_code:'10016'}));assert.throws(()=>cents('1.005'));assert.deepEqual(allocate(2,[1,1,1]),[1,1,0]);
});
test('preview migration, permissions, exact address, order and filing accounting',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table auth.users(id uuid primary key);create table admin_users(user_id uuid primary key);
 create table checkout_quotes(id uuid primary key,user_id uuid,status text,expires_at timestamptz,updated_at timestamptz,subtotal numeric,shipping_amount numeric,card_surcharge numeric,line_items jsonb,spot_snapshot jsonb);
 create table orders(id bigint generated always as identity primary key,order_number text,user_id uuid,first_name text,last_name text,email text,phone text,payment_method text,subtotal numeric,payment_surcharge numeric,shipping_amount numeric,total numeric,spot_snapshot jsonb,price_locked_until timestamptz,shipping_address jsonb,customer_notes text,payment_status text default 'unpaid',paid_at timestamptz,created_at timestamptz default now());
 create table products(id bigint primary key,is_active boolean,inventory_count int,sku text,name text,metal text,metal_weight_oz numeric);
 create table order_items(order_id bigint,product_id bigint,sku text,product_name text,metal text,metal_weight_oz numeric,quantity int,unit_price numeric,line_total numeric,pricing_snapshot jsonb);
 create function private.next_customer_order_number() returns text language sql as $$select 'DEMO-1'::text$$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261127005544_tax_registration_profiles.sql',import.meta.url),'utf8'));
 assert.equal((await db.query("select to_regprocedure('public.create_order_from_quote(uuid,uuid,jsonb,jsonb,text,text)') is null as untouched")).rows[0].untouched,true);
 assert.equal((await db.query("select has_table_privilege('anon','private.tax_states','select') as exposed")).rows[0].exposed,false);
 await db.exec(await readFile(new URL('../supabase/migrations/20261127010440_tax_dealer_confirmation.sql',import.meta.url),'utf8'));
 const orderRoutine="public.create_order_from_quote(uuid,uuid,jsonb,jsonb,text,text)";
 const pickupMigration=await readFile(new URL('../supabase/migrations/20261126234000_shared_pickup.sql',import.meta.url),'utf8');
 const existingOrderFunction=pickupMigration.match(/CREATE OR REPLACE FUNCTION public\.create_order_from_quote[\s\S]+?\$function\$\s*;/)[0];
 await db.exec(existingOrderFunction);
 const orderDefinition=async()=>(await db.query('select pg_get_functiondef($1::regprocedure) as definition',[orderRoutine])).rows[0].definition;
 const beforeInstall=await orderDefinition();
 await db.exec(await readFile(new URL('../supabase/migrations/20261127013002_nationwide_tax_compliance.sql',import.meta.url),'utf8'));
 await db.exec("insert into products values(902,true,2,'AGE-1OZ-BU-RY','1 oz American Gold Eagle BU (Random Year)','gold',1)");
 await db.exec(await readFile(new URL('../supabase/migrations/20261127015640_reviewed_bullion_catalog.sql',import.meta.url),'utf8'));
 const shippedRule=(await db.query("select state,data->>'treatment' as treatment from private.tax_versions where subject='902' order by state")).rows;
 assert.equal(shippedRule.find(r=>r.state==='WA').treatment,'taxable');
 assert.equal(shippedRule.find(r=>r.state==='TX').treatment,'eligible');
 assert.equal(shippedRule.some(r=>r.state==='FL'),false);
 assert.equal((await db.query("select private.tax_collection_gate('NH',private.tax_version('NH','policy','state','2026-11-26'),'2026-11-26') as decision")).rows[0].decision,'no_obligation');
 await db.exec(await readFile(new URL('../supabase/migrations/20261127030000_website_nexus_activity.sql',import.meta.url),'utf8'));
 const closeFor=async(d)=>(await db.query("select private.tax_ny_market_inputs(private.tax_version('NY','product','902','2026-11-26'),$1) as value",[d])).rows[0].value;
 const actualClose=await closeFor('2026-11-26');
 assert.equal(actualClose.market_unit_cents,358845);
 assert.equal(actualClose.face_usd_cents,5000);
 const currentSku=input(400000);
 currentSku.lines[0].classification=actualClose;
 assert.equal(assess(currentSku).tax,0);
 assert.equal((await closeFor('2026-11-27')).market_unit_cents,undefined);
 await db.exec("begin");
 try {
   await db.exec(`insert into orders(payment_status,paid_at,shipping_address,total,tax_amount) values
    ('paid','2025-04-01T16:00Z','{"state":"WA"}',80001,0),('paid','2026-04-01T16:00Z','{"state":"WA"}',20000,0),
    ('unpaid','2026-04-01T16:00Z','{"state":"WA"}',500000,0),('paid','2026-04-02T16:00Z','{"state":"WA","fulfillment":"pickup"}',90000,0)`);
   const activity=async()=>(await db.query("select * from private.tax_website_activity('2026-11-26','2026-01-01','2026-11-26') where state='WA'")).rows[0];
   assert.equal(Number((await activity()).period_orders),1);
   assert.match((await activity()).review_message,/80%/);
   await db.exec(`insert into orders(payment_status,paid_at,shipping_address,total,tax_amount) values ('paid','2026-06-01T16:00Z','{"state":"WA"}',80000.01,0)`);
   assert.match((await activity()).review_message,/reached a registration/);
 } finally { await db.exec("rollback"); }
 await db.exec("alter table orders alter column id restart with 1");
 // The following order tests create their own dated policies and version histories.
 await db.exec("delete from private.tax_versions where data->>'origin'='catalog_policy_release_2026_11_26'");
 assert.equal(await orderDefinition(),beforeInstall);
 assert.equal((await db.query("select count(*)::int as count from pg_trigger where tgrelid='public.orders'::regclass and not tgisinternal")).rows[0].count,0);
 assert.ok((await db.query("select to_regprocedure('public.tax_quote_inputs(uuid,uuid,jsonb)') is not null as installed")).rows[0].installed);
 await db.exec(await readFile(new URL('../supabase/migrations/20261128000100_activate_tax_checkout.sql',import.meta.url),'utf8'));
 // Install the public checkout entry point, its wire agreement and email queues.
 const migration = name => readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 await db.exec(`alter table orders add column status text default 'awaiting_payment', add column terms_version text,
   add column terms_accepted_at timestamptz, add column terms_user_agent text, add column terms_ip_hash text,
   add column payment_provider text, add column payment_reference text, add column payment_due_at timestamptz,
   add column insurance_amount numeric default 0, add column tracking_number text;
   alter table auth.users add column email text default 'fixture@example.invalid', add column email_confirmed_at timestamptz default now();
   create table app_settings(key text primary key,value jsonb);
   insert into app_settings values('order_emails_enabled','true');
   create table order_email_outbox(order_id bigint,event_key text,event_type text constraint order_email_outbox_event_type_check check(event_type in ('placed')),
     recipient text,order_snapshot jsonb,status text default 'pending',attempts integer default 0,last_error text,available_at timestamptz,unique(order_id,event_key));
   create table order_delivery_info(order_id bigint,details jsonb);
   create function public.get_wire_instructions_secret() returns jsonb language sql as $$select '{"bank_name":"Test Bank","beneficiary_name":"Test","routing_number":"000000000","account_number":"00000000"}'::jsonb$$;`);
 await db.exec(await migration('20261022214403_wire_agreement_and_reliable_instructions.sql'));
 await db.exec(await migration('20261023030443_versioned_purchase_terms.sql'));
 await db.exec(`alter table order_items add column id bigint generated always as identity;
   create table order_unit_tags(order_id bigint,line_id bigint,unit int,serial text,details jsonb);`);
 const documents = await migration('20261116173317_order_documents_delivery.sql');
 await db.exec(documents.match(/create function public\.order_document_state[\s\S]+?\$\$;/)[0]);
 const ach = await migration('20261107233400_ach_checkout.sql');
 await db.exec(ach.match(/CREATE OR REPLACE FUNCTION public\.place_checkout_order[\s\S]+?\$function\$\s*;/)[0]);
 await db.exec(await migration('20261116180336_order_email_milestones.sql'));
 await db.exec('create trigger order_email_queue after insert or update of status,payment_status,tracking_number on orders for each row execute function private.queue_order_email()');
 await db.exec(await migration('20261128000200_checkout_tax_receipts.sql'));
 const val=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 assert.equal(await val('select count(*)::int from private.tax_states'),51);
 assert.equal(await val("select has_function_privilege('authenticated','public.tax_admin_overview(date,date)','execute')"),false);
 const actor='00000000-0000-4000-8000-000000000001',qid='00000000-0000-4000-8000-000000000002';
 await db.query('insert into auth.users values($1)',[actor]);await db.query('insert into admin_users values($1)',[actor]);
 await db.query("select public.tax_admin_change($1,'NY','schedule',$2)",[actor,{starts:'2026-09-01',ends:'2026-11-30',due:'2026-12-21'}]);
 await db.query("select public.tax_publish_version($1,'WA','nexus','state',$2,'https://dor.wa.gov/', '2025-01-01','2027-12-31','2026-11-26','approved')",[actor,{period:'current_or_prior_calendar',base:'gross',operator:'or',revenue_trigger_cents:10000001,deduct_refunds:false,include_marketplace:true}]);
 await db.query("select public.tax_import_sale($1,'WA','reference-a','marketplace','2025-02-01',10000001,0,10000001,0)",[actor]);
 const progress=await val("select private.tax_threshold_progress('WA','2026-11-26')");assert.equal(progress.reached,true);assert.equal(progress.periods[0].sales_cents,0);
 await db.exec("select public.tax_deadline_scan('2026-12-20');select public.tax_deadline_scan('2026-12-20');");
 assert.equal(await val("select count(*)::int from private.tax_alerts where event_key like 'filing:%'"),1);
 await db.query("select public.tax_admin_change($1,'NY','file',$2)",[actor,{id:1,filed:'2026-12-19',confirmation:'test-ref',reported:0}]);
 await db.query("select public.tax_admin_change($1,'NY','remit',$2)",[actor,{id:1,paid:0,paid_on:'2026-12-19',payment_reference:'zero-return',payment_method:'no balance'}]);
 await db.query("insert into checkout_quotes values($1,$2,'active',now()+interval '10 minutes',now(),100,0,0,'[]','{}')",[qid,actor]);
 const address={address_line_1:'149 Madison Avenue',address_line_2:'Floor 6, Room 614',city:'New York',state:'NY',postal_code:'10016',country:'US'}, contact={first_name:'Test',last_name:'Buyer',email:'fixture@example.invalid',phone:'5550100'};
 const place=shipping=>val("select public.create_order_from_quote($1,$2,$3,$4,'wire',null)",[actor,qid,contact,shipping]);
 await assert.rejects(place(address),/tax and total/);
 const date=await val("select (now() at time zone 'America/New_York')::date::text");
 await db.query("insert into private.tax_versions(state,kind,subject,valid_from,valid_until,verified_on,source,approval,data,actor) values('NY','policy','state',current_date-1,current_date+1,current_date,'https://www.tax.ny.gov/','approved','{}',$1)",[actor]);
 const quoteDealer=()=>val("select public.tax_quote_inputs($1,$2,$3)->'policy'->>'ny_dealer_status'",[actor,qid,address]);
 assert.equal(await quoteDealer(),null);
 await db.query("update private.tax_states set ny_dealer_status='registration_not_required',ny_dealer_confirmed_on=$1 where state='NY'",[date]);
 assert.equal(await quoteDealer(),'registration_not_required');
 await db.exec("update private.tax_versions set data=jsonb_build_object('ny_dealer_status','required_unregistered') where state='NY' and kind='policy'");
 assert.equal(await quoteDealer(),'required_unregistered');
 await db.exec("update private.tax_versions set data='{}' where state='NY' and kind='policy'");
 const id=await val("select public.store_tax_assessment($1,$2,$3,'wire','pickup',$4,(select revision from private.tax_revision))",[actor,qid,address,{day:date,state:'NY',collection:'collect',subtotal:10000,taxable:10000,exempt:0,tax:888,total:10888,breakdown:[{level:'state',code:'NY',ppm:40000,cents:400},{level:'city',code:'NYC',ppm:45000,cents:450},{level:'district',code:'MCTD',ppm:3750,cents:38}]}]);
 await assert.rejects(place({...address,fulfillment:'pickup',tax_assessment_id:id,city:'Changed'}));
 await assert.rejects(place({...address,fulfillment:'pickup',tax_assessment_id:id}),/collection obligation/);
 await db.query("select public.tax_admin_change($1,'NY','settings',$2)",[actor,{registration:'Registered',disabled:false}]);
 const nyProfile=(await db.query("select effective,collect_from,active_confirmed_on::text as confirmed from private.tax_states where state='NY'")).rows[0];
 assert.equal(nyProfile.effective,null);assert.equal(nyProfile.collect_from,null);assert.equal(nyProfile.confirmed,date);
 await db.exec("update private.tax_states set registration='Registered',effective=current_date-1,collect_from=current_date-1 where state='WA'");
 const refreshedId=await val("select public.store_tax_assessment($1,$2,$3,'wire','pickup',(select result from private.tax_assessments where id=$4),(select revision from private.tax_revision))",[actor,qid,address,id]);
 const order=await place({...address,fulfillment:'pickup',tax_assessment_id:refreshedId});assert.equal(order.total,108.88);
 await db.exec("update orders set payment_status='paid'");await db.exec("update orders set payment_status='paid'");
 assert.equal(await val("select count(*)::int from private.tax_ledger where kind='sale' and state='NY'"),1);
 assert.equal(await val("select tax::int from private.tax_ledger where kind='sale' and state='NY'"),888);
 await db.query("select public.tax_refund_entry($1,'NY',1,'test-refund',$2,5000,5000,0,'[]')",[actor,date]);
 await assert.rejects(db.query("select public.tax_refund_entry($1,'NY',1,'test-refund-again',$2,6000,6000,0,'[]')",[actor,date]),/exceeds/);
 const components=await val("select public.tax_period_components('NY',$1,$1)",[date]);assert.equal(components.reduce((n,c)=>n+c.cents,0),888);
 const period=await val("select public.tax_report_rows('NY',$1,$1)",[date]);assert.ok(period.some(r=>r.kind==='refund'));
 await assert.rejects(db.exec("update orders set total=100"),/new checkout/);
 await db.query("insert into private.tax_versions(state,kind,subject,valid_from,valid_until,verified_on,source,approval,data,actor) values('WA','policy','state',current_date-1,current_date+1,current_date,'https://dor.wa.gov/','approved','{}',$1)",[actor]);
 for (const [city,street,zip,code,expectedTax] of [
   ['Spokane','808 W SPOKANE FALLS BLVD','99201','3210',4550000],
   ['Seattle','600 4TH AVE','98104','1726',5275000],
 ]) {
   const ship={address_line_1:street,city,state:'WA',postal_code:zip,country:'US'};
   const xml=await readFile(new URL('./fixtures/tax/'+city.toLowerCase()+'-q42026.xml',import.meta.url),'utf8');
   const purchase=input(50000000);
   purchase.state='WA';purchase.policy={...policy,state:'WA',first_eligible_cent:0};
   purchase.address=washingtonResult(xml,day,ship,code);
   purchase.lines[0].classification={...product,treatment:'taxable'};
   const result=assess(purchase);
   const quoteId=await val("insert into checkout_quotes values(gen_random_uuid(),$1,'active',now()+interval '10 minutes',now(),500000,0,0,'[]','{}') returning id",[actor]);
   const assessmentId=await val("select public.store_tax_assessment($1,$2,$3,'wire','delivery',$4,(select revision from private.tax_revision))",[actor,quoteId,ship,{...result,day:date}]);
   const placeWire=()=>val('select public.place_checkout_order($1,$2,$3,$4,$5,null,$6,$7,null,null)',
     [actor,quoteId,contact,{...ship,tax_assessment_id:assessmentId},'wire',{accepted:true,version:'2026-10-22-v2'},{accepted:true,version:WIRE_AGREEMENT_VERSION}]);
   const placed=await placeWire();
   const replayed=await placeWire();
   assert.equal(replayed.order_id,placed.order_id);
   for (const receipt of [placed,replayed]) {
     assert.equal(cents(receipt.tax_amount),expectedTax);
     assert.equal(cents(receipt.total),50000000+expectedTax);
   }
   const agreed=await val('select wire_agreed_total from orders where id=$1',[placed.order_id]);
   assert.equal(cents(agreed),cents(placed.total));
   const stored=(await db.query("update orders set payment_status='paid' where id=$1 returning *",[placed.order_id])).rows[0];
   const emails=(await db.query('select event_type,order_snapshot from order_email_outbox where order_id=$1',[placed.order_id])).rows;
   assert.deepEqual(emails.map(e=>e.event_type).sort(),['paid','placed','wire_instructions']);
   const wire=await val('select public.get_wire_instructions_secret()');
   for (const email of emails) {
     assert.equal(cents(email.order_snapshot.tax_amount),expectedTax);
     assert.equal(cents(email.order_snapshot.total),cents(placed.total));
     const message=renderOrderEmail({event:email.event_type,order:email.order_snapshot,wire});
     const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(expectedTax/100);
     assert.ok(message.text.includes('Sales tax: '+amount));
     assert.ok(message.html.includes(amount));
   }
   const invoice=await val('select public.order_document_state($1)',[placed.order_id]);
   assert.equal(cents(invoice.order.tax_amount),expectedTax);
   assert.equal(cents(invoice.order.total),orderTotalCents(stored));
   assert.equal(cents(stored.tax_amount),expectedTax);
   assert.equal(orderTotalCents(stored),50000000+expectedTax);
   assert.equal(cents(placed.total),orderTotalCents(stored));
   assert.equal(await val("select tax::int from private.tax_ledger where order_id=$1",[placed.order_id]),expectedTax);
   assert.throws(()=>orderTotalCents({...stored,tax_amount:'0.01'}),/reconciliation/);
 }
 // The card amount includes its fee. Retry must return the persisted assessment.
 const cardQuote=await val("insert into checkout_quotes values(gen_random_uuid(),$1,'active',now()+interval '10 minutes',now(),100,0,4,'[]','{}') returning id",[actor]);
 const cardAssessment=await val("select public.store_tax_assessment($1,$2,$3,'card','pickup',$4,(select revision from private.tax_revision))",
   [actor,cardQuote,address,{day:date,state:'NY',collection:'collect',subtotal:10000,taxable:10400,exempt:0,tax:923,total:11323,breakdown:[{level:'state',code:'NY',ppm:40000,cents:416},{level:'city',code:'NYC',ppm:45000,cents:468},{level:'district',code:'MCTD',ppm:3750,cents:39}]}]);
 const placeCard=()=>val("select public.place_checkout_order($1,$2,$3,$4,'card',null,$5,null,null,null)",
   [actor,cardQuote,contact,{...address,fulfillment:'pickup',tax_assessment_id:cardAssessment},{accepted:true,version:'2026-10-22-v2'}]);
 const card=await placeCard(), repeatedCard=await placeCard();
 assert.equal(repeatedCard.order_id,card.order_id);
 const cardOrder=await val('select to_jsonb(o) from orders o where id=$1',[card.order_id]);
 assert.equal(orderTotalCents(cardOrder),11323);
 for(const receipt of [card,repeatedCard]) {
   assert.equal(cents(receipt.tax_amount),923);
   assert.equal(cents(receipt.total),orderTotalCents(cardOrder));
 }
 const waReport=await val("select public.tax_period_components('WA',$1,$1)",[date]);
 assert.equal(waReport.reduce((sum,row)=>sum+row.cents,0),9825000);
 const openQuote=await val("insert into checkout_quotes values(gen_random_uuid(),$1,'active',now()+interval '10 minutes',now(),500000,0,0,'[]','{}') returning id",[actor]);
 await db.query("select public.tax_admin_change($1,'WA','settings',$2)",[actor,{registration:'Not Registered',disabled:false}]);
 const waPolicy=await val("select public.tax_quote_inputs($1,$2,$3)->'policy'",[actor,openQuote,{...address,state:'WA'}]);
 assert.equal(waPolicy.registration,'Not Registered');
 assert.equal(waPolicy.shipping_disabled,false);
 assert.equal(waPolicy.collection,'review');
 assert.equal(await val("select count(*)::int from private.tax_states where not disabled"),51);
 }finally{await db.close();}
});

import {belowOrderMinimum,storeFloor} from '../shared/bullionMinimums.js';
import {previewExample} from '../server/tax/preview.js';
import {censusRates} from '../server/tax/destinationRates.js';
import {newMexicoAddress} from '../server/tax/newMexico.js';

for (const [state,floor] of Object.entries({NY:100001,CA:200000,MD:100001,MA:100000,CT:100000})) {
  test(state+' shows its store minimum only below the cutoff',()=>{
    assert.ok(belowOrderMinimum(state,floor-1,day));
    assert.equal(belowOrderMinimum(state,floor,day),'');
    assert.equal(belowOrderMinimum(state,floor+1,day),'');
    assert.equal(previewExample(state,floor-1).remaining,1);
    assert.equal(previewExample(state,floor).tax,0);
  });
}
test('destination switch removes the minimum; NJ uses individual coin values; CT floor expires',()=>{
  assert.equal(belowOrderMinimum('WA',50000,day),'');
  assert.equal(storeFloor('NJ',day),0);
  assert.equal(storeFloor('CT','2027-07-01'),0);
});
test('minimum message can be shown before reviewing an exemption or requesting consent',()=>{
  const q=input(100000);q.policy=null;q.investment=false;
  assert.throws(()=>assess(q),e=>e.code==='ORDER_MINIMUM' && /New York.*\$1,000.01/.test(e.message));
  const above=input(110000);above.investment=false;
  assert.equal(assess(above).tax,9763);
});
test('California checks statutory market value separately from the store subtotal',()=>{
  const q=input(205000);q.state='CA';q.policy={...policy,state:'CA',first_eligible_cent:200000};
  q.address={...address,state:'CA'};q.lines[0].classification={...product,market_unit_cents:199999};
  assert.equal(assess(q).taxable,205000);
});
for(const [state,expected] of Object.entries({WA:200000,DC:120000,ME:110000,VT:140000,HI:94240,NM:163750})) {
  test(state+' charged example on $20,000 returns one combined customer amount',()=>{
    assert.equal(previewExample(state,2000000).tax,expected);
    assert.equal(previewExample(state,2000000).total,2000000+expected);
  });
}
test('Hawaii seller liability is distinct from the amount passed to the buyer',()=>{
  const q=input(2000000);q.state='HI';q.lines[0].classification={...product,treatment:'taxable'};
  q.address={...address,state:'HI',rates:[{level:'state',code:'HI',ppm:40000},{level:'county',code:'15003',ppm:5000}],max_pass_on_ppm:47120};
  q.policy={...policy,state:'HI',first_eligible_cent:0,seller_levy_treatment:'absorb'};
  assert.equal(assess(q).tax,0);assert.equal(assess(q).seller_taxes[0].cents,90000);
  q.policy.seller_levy_treatment='pass_through';
  assert.equal(assess(q).seller_taxes[0].customer_funded_cents,94240);
  q.address.max_pass_on_ppm=47500;assert.throws(()=>assess(q));
});
test('full-address review distinguishes Vermont municipalities and refuses unknown locations',()=>{
  const a={address_line_1:'149 Church Street',city:'Burlington',state:'VT',postal_code:'05401'};
  const m={matchedAddress:'149 CHURCH ST, BURLINGTON, VT, 05401',addressComponents:{city:'BURLINGTON',state:'VT',zip:'05401'},
    geographies:{States:[{STUSAB:'VT',GEOID:'50'}],Counties:[{GEOID:'50007'}],'County Subdivisions':[{GEOID:'5000710675',NAME:'Burlington city'}]}};
  assert.deepEqual(censusRates(a,day,[m]).rates.map(r=>r.ppm),[60000,10000]);
  assert.throws(()=>censusRates({...a,address_line_1:'151 Church Street'},day,[m]));
  assert.throws(()=>censusRates(a,'2027-01-01',[m]));
  m.geographies['County Subdivisions'][0].NAME='Unreviewed town';assert.throws(()=>censusRates(a,day,[m]));
});
test('New Mexico checks the complete street match and the government location code',async()=>{
  const a={address_line_1:'3804 Central Ave SE',city:'Albuquerque',state:'NM',postal_code:'87108'};
  const row={street_number:'3804',street_name:'CENTRAL',street_suffix:'AVE',street_post_directional:'SE',city:'ALBUQUERQUE',zipcode:'87108',county:'Bernalillo',source:'NM E911',success:true,location_code:'02-100',tax_rate:'7.625'};
  const mock=async()=>({ok:true,json:async()=>({results:[row]})});
  assert.equal((await newMexicoAddress(a,day,mock)).rates[0].ppm,76250);
  row.source='Mapquest Geocode';await assert.rejects(newMexicoAddress(a,day,mock));
});

for(const e of [
  {place:'spokane',city:'Spokane',street:'W SPOKANE FALLS BLVD',number:808,zip:'99201',code:'3210',local:'.026',total:'.091',county:'Spokane',tax:4550000},
  {place:'seattle',city:'Seattle',street:'4TH AVE',number:600,zip:'98104',code:'1726',local:'.0405',total:'.1055',county:'King',tax:5275000}
]) test(e.city+': verified $500,000 bullion benchmark reconciles state, local, and total',async()=>{
  const xml=await readFile(new URL('./fixtures/tax/'+e.place+'-q42026.xml',import.meta.url),'utf8');
  const address={state:'WA',city:e.city,address_line_1:e.number+' '+e.street,postal_code:e.zip};
  const result=washingtonResult(xml,day,address,e.code);
  const q=input(50000000);q.state='WA';q.address=result;q.policy={...policy,state:'WA',first_eligible_cent:0};
  q.lines[0].classification={...product,treatment:'taxable'};
  const charge=assess(q);
  assert.equal(charge.tax,e.tax);assert.equal(charge.total,50000000+e.tax);
  assert.equal(charge.breakdown[0].cents,3250000);assert.equal(charge.breakdown[1].county,e.county);
  assert.equal(charge.breakdown[1].cents,e.tax-3250000);assert.ok(charge.breakdown[1].districts.length);
  assert.equal(previewExample('WA',50000000,e.place).tax,e.tax);
  q.policy.collection='no_obligation';const other=assess(q);assert.equal(other.tax,0);assert.equal(other.taxable,50000000);
});
test('real-WA benchmark difference is $7,250 for the same taxable merchandise',()=>{
  assert.equal(previewExample('WA',50000000,'seattle').tax-previewExample('WA',50000000,'spokane').tax,725000);
});
test('NYC pickup or delivery requires a matching county and city geography for the general NYC rate',()=>{
  const a={address_line_1:'149 MADISON AVE',city:'NEW YORK',state:'NY',postal_code:'10016'};
  const m={matchedAddress:'149 MADISON AVE, NEW YORK, NY, 10016',addressComponents:{zip:'10016',state:'NY',city:'NEW YORK'},
    geographies:{States:[{STUSAB:'NY',GEOID:'36'}],Counties:[{GEOID:'36061',NAME:'New York County'}],'Incorporated Places':[{GEOID:'3651000'}]}};
  assert.deepEqual(censusRates(a,day,[m]).rates.map(c=>c.ppm),[40000,45000,3750]);
  m.geographies.Counties=[{GEOID:'36119'}];assert.deepEqual(censusRates(a,day,[m]).rates,[]);
});

import {previewStreetOrder} from '../server/tax/preview.js';
import {locationCsv} from '../server/tax/locationExport.js';
import vtLocations from '../server/tax/vermontQuarter.json' with {type:'json'};
import nmLocations from '../server/tax/newMexicoLocations.json' with {type:'json'};
import waLocations from '../server/tax/washingtonQuarter.json' with {type:'json'};
const delivered={address_line_1:'123 MAIN ST',city:'EXAMPLE',postal_code:'00000',country:'US'};
const matched=async address=>({status:'matched',address});
function sampleGeography(state,geo,extra){
  return [{matchedAddress:'123 MAIN ST, EXAMPLE, '+state+', 00000',addressComponents:{city:'EXAMPLE',state,zip:'00000'},
    geographies:{States:[{STUSAB:state,GEOID:geo}],...extra}}];
}
test('all Vermont subdivisions use the published retail local option for their own jurisdiction',()=>{
  const entries=Object.entries(vtLocations.municipalities);
  assert.equal(entries.length,256);assert.equal(entries.filter(([,r])=>r[1]>0).length,37);
  for(const [code,[name,local]] of entries){
    const geo=sampleGeography('VT','50',{Counties:[{GEOID:code.slice(0,5)}],'County Subdivisions':[{GEOID:code,NAME:name}]});
    const r=censusRates({...delivered,state:'VT'},day,geo);
    assert.equal(r.rates.reduce((s,c)=>s+c.ppm,0),60000+local);
    if(['Montgomery town','Barre town','Killington town'].includes(name))assert.equal(local,0);
    if(['Barre city','Peru town','Hartford town'].includes(name))assert.equal(local,10000);
  }
});
test('Hawaii assigns each published retail surcharge by county and keeps the pass-on separate',async()=>{
  for(const code of ['15001','15003','15007','15009']){
    const address={...delivered,state:'HI'};
    const verified=censusRates(address,day,sampleGeography('HI','15',{Counties:[{GEOID:code}]}));
    assert.equal(verified.rates[1].code,code);assert.equal(verified.rates[1].ppm,5000);
    const result=await previewStreetOrder(address,1000000,day,{correct:matched,resolvers:{HI:async()=>verified}});
    assert.equal(result.tax,47120);assert.equal(result.location,verified.rates[1].name);
  }
  assert.throws(()=>censusRates({...delivered,state:'HI'},day,sampleGeography('HI','15',{Counties:[{GEOID:'15005'}]})));
});
test('Washington can use an exact government street hit missing from the archive and rejects a range-only or ZIP response',async()=>{
  const xml=await readFile(new URL('./fixtures/tax/seattle-q42026.xml',import.meta.url),'utf8');
  const address={state:'WA',city:'Seattle',postal_code:'98104',address_line_1:'600 4TH AVE'};
  assert.equal(washingtonStreetCode(Buffer.from(''),address,{allowMissing:true}),null);
  assert.equal(washingtonResult(xml,day,address,null).rates[1].code,'1726');
  assert.throws(()=>washingtonResult(xml.replace('househigh="600"','househigh="698"'),day,address,null));
  assert.throws(()=>washingtonResult(xml.replace('code="2"','code="5"'),day,address,null));
  assert.throws(()=>washingtonResult(xml,day,address,'3210'));
});
test('NM exact address cannot use an outdated rate, county conflict or an expired schedule',async()=>{
  const address={state:'NM',address_line_1:'3804 CENTRAL AVE SE',city:'ALBUQUERQUE',postal_code:'87108'};
  const row={street_number:'3804',street_name:'CENTRAL',street_suffix:'AVE',street_post_directional:'SE',city:'ALBUQUERQUE',zipcode:'87108',county:'Bernalillo',source:'NM E911',success:true,location_code:'02-100',tax_rate:'7.6250'};
  const mock=async()=>({ok:true,json:async()=>({results:[row]})});
  assert.equal((await newMexicoAddress(address,day,mock)).rates[0].county,'Bernalillo');
  await assert.rejects(newMexicoAddress(address,'2027-07-01',mock));
  row.tax_rate='7.8750';await assert.rejects(newMexicoAddress(address,day,mock));
  row.tax_rate='7.6250';row.county='Santa Fe';await assert.rejects(newMexicoAddress(address,day,mock));
});
test('street preview returns corrections and unknown locations without quoting a sample price',async()=>{
  const a={...delivered,state:'WA'};
  for(const status of ['suggestion','needs_input','unavailable']){
    const r=await previewStreetOrder(a,500000,day,{correct:async()=>({status,address:a}),resolvers:{}});
    assert.equal(r.status,status);assert.equal(r.tax,undefined);
  }
  const r=await previewStreetOrder(a,500000,day,{correct:matched,resolvers:{WA:async()=>{throw Error()}}});
  assert.equal(r.status,'unavailable');assert.equal(r.tax,undefined);
});
test('coverage export includes all published records and labels special cases',()=>{
  const lines=locationCsv().trim().split('\r\n');
  const count=state=>lines.filter(line=>line.startsWith('"'+state+'",')).length;
  assert.equal(count('WA'),Object.keys(waLocations.rates).length);assert.equal(count('WA'),403);
  assert.equal(count('VT'),256);assert.equal(count('HI'),5);
  assert.equal(count('NM'),nmLocations.locations.reduce((n,r)=>n+(r.code?1:r.tribal_codes.length),0));
  assert.equal(new Set(nmLocations.locations.map(r=>r.county)).size,33);
  assert.ok(lines.some(line=>line.includes('Tribal reporting class 2')));
});

test('NY investment exemption requires a reviewed dealer determination independent of the sales tax permit',()=>{
  const q=input(140000);
  q.policy={...policy,ny_dealer_status:null};
  assert.throws(()=>assess(q),/dealer eligibility/);
  q.policy.ny_dealer_status='required_unregistered';assert.equal(assess(q).tax,12425);
  q.policy.ny_dealer_status='registration_not_required';assert.equal(assess(q).tax,0);
  q.policy.ny_dealer_status=null;q.investment=false;assert.equal(assess(q).tax,12425);
});
test('checkout rejects a combined rate layered on its own components',()=>{
  const q=input(140000);q.investment=false;
  for(const extra of [{code:'NY-TOTAL',level:'combined',ppm:88750},{code:'LOCAL',level:'combined_local',ppm:48750},
    {code:'STATE-2',level:'state',ppm:40000},{code:'nyc ',level:'city',ppm:45000}]){
    q.address={...address,rates:[...address.rates,extra]};assert.throws(()=>assess(q),/overlap|duplicated/);
  }
  q.address={...address,rates:[{code:'ALL',level:'combined',ppm:88750}]};assert.equal(assess(q).tax,12425);
});

test('NY uses the verified preceding business day, including a weekend or holiday gap',()=>{
 const forFriday = input(150000);
 forFriday.day='2026-11-27';
 const classification={...product,market_day:forFriday.day};
 forFriday.lines[0].classification=classification;
 assert.equal(assess(forFriday).lines[0].market_day,'2026-11-25');
 for (const observed of [forFriday.day,'2026-11-24',undefined]) {
   forFriday.lines[0].classification={...classification,market_observed_on:observed};
   assert.throws(()=>assess(forFriday),/bullion market value/);
 }
});
test('NY Westchester city boundaries determine the rate and reporting code independently of postal city',()=>{
 const geo={Counties:[{GEOID:'36119',NAME:'Westchester County'}]};
 const resolve=(name,place)=>{
   geo['County Subdivisions']=[{GEOID:'3611984000',NAME:name}];
   geo['Incorporated Places']=place?[{NAME:place}]:[];
   return newYorkComponents(geo,day);
 };
 const city=resolve('Yonkers city','Yonkers city');
 assert.equal(city[1].reporting_code,'6511');
 assert.equal(city.reduce((n,r)=>n+r.ppm,0),88750);
 assert.equal(city[1].included_rates[0].ppm,3750);
 assert.equal(resolve('Greenburgh town')[1].reporting_code,'5581');
 assert.equal(resolve('Greenburgh town')[1].ppm,43750);
 assert.deepEqual(resolve('Greenburgh town','Yonkers city'),[]);
 assert.deepEqual(resolve('Yonkers city'),[]);
});
import {newYorkComponents} from '../server/tax/newYork.js';
