import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assess,allocate,cents} from '../server/tax/engine.js';
import {washingtonResult,washingtonStreetCode} from '../server/tax/washington.js';
import {normalizeAddress} from '../server/tax/quote.js';
import states from '../shared/taxSources.json' with {type:'json'};
const day='2026-11-26';
const record={source:'https://www.nysenate.gov/legislation/laws/TAX/1115',approval:'approved',version:1,valid_from:'2026-01-01',valid_until:'2026-12-31',verified_on:day};
const product={...record,treatment:'eligible',form:'bar',metal:'gold',market_day:day,market_unit_cents:200000,market_source:record.source};
const policy={...record,state:'NY',collection:'collect',registration:'Registered',first_eligible_cent:100001,store_minimum:true,shipping_base:'full_if_taxable',fee_base:'full_if_taxable',rounding:'combined'};
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
 create table orders(id bigint generated always as identity primary key,order_number text,user_id uuid,first_name text,last_name text,email text,phone text,payment_method text,subtotal numeric,payment_surcharge numeric,shipping_amount numeric,total numeric,spot_snapshot jsonb,price_locked_until timestamptz,shipping_address jsonb,customer_notes text,payment_status text default 'unpaid');
 create table products(id bigint primary key,is_active boolean,inventory_count int);
 create table order_items(order_id bigint,product_id bigint,sku text,product_name text,metal text,metal_weight_oz numeric,quantity int,unit_price numeric,line_total numeric,pricing_snapshot jsonb);
 create function private.next_customer_order_number() returns text language sql as $$select 'DEMO-1'::text$$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261127000000_nationwide_tax_compliance.sql',import.meta.url),'utf8'));
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
 const id=await val("select public.store_tax_assessment($1,$2,$3,'wire','pickup',$4,(select revision from private.tax_revision))",[actor,qid,address,{day:date,state:'NY',collection:'collect',subtotal:10000,taxable:10000,exempt:0,tax:888,total:10888,breakdown:[]}]);
 await assert.rejects(place({...address,fulfillment:'pickup',tax_assessment_id:id,city:'Changed'}));
 const order=await place({...address,fulfillment:'pickup',tax_assessment_id:id});assert.equal(order.total,108.88);
 await db.exec("update orders set payment_status='paid'");await db.exec("update orders set payment_status='paid'");
 assert.equal(await val("select count(*)::int from private.tax_ledger where kind='sale' and state='NY'"),1);
 assert.equal(await val("select tax::int from private.tax_ledger where kind='sale' and state='NY'"),888);
 await db.query("select public.tax_refund_entry($1,'NY',1,'test-refund',$2,5000,5000,0,'[]')",[actor,date]);
 await assert.rejects(db.query("select public.tax_refund_entry($1,'NY',1,'test-refund-again',$2,6000,6000,0,'[]')",[actor,date]),/exceeds/);
 const period=await val("select public.tax_report_rows('NY',$1,$1)",[date]);assert.ok(period.some(r=>r.kind==='refund'));
 await assert.rejects(db.exec("update orders set total=100"),/new checkout/);
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
for(const [state,expected] of Object.entries({WA:200000,DC:120000,ME:110000,VT:140000,HI:94240,NM:168750})) {
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
  const row={street_number:'3804',street_name:'CENTRAL',street_suffix:'AVE',street_post_directional:'SE',city:'ALBUQUERQUE',zipcode:'87108',county:'Bernalillo',source:'NM E911',success:true,location_code:'02-100',tax_rate:'7.875'};
  const mock=async()=>({ok:true,json:async()=>({results:[row]})});
  assert.equal((await newMexicoAddress(a,day,mock)).rates[0].ppm,78750);
  row.source='Mapquest Geocode';await assert.rejects(newMexicoAddress(a,day,mock));
});
