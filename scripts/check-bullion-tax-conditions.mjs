import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {calculateAdminOrder} from '../server/tax/adminOrderReport.js';
import {washingtonResult,washingtonStreetCode} from '../server/tax/washington.js';
import {assess} from '../server/tax/engine.js';
import {completeOrderMarketInputs} from '../server/tax/bullionMarket.js';
const day='2026-11-26';
const fixture={valid_from:day,valid_until:day,verified_on:day,version:1,approval:'approved',source:'https://example.invalid/test'};
const coin=(more={})=>({...fixture,form:'coin',metal:'gold',treatment:'eligible',...more});
function run(state,items,overrides={}) {
 const lines=items.map(([gross,classification,quantity=1,terms={}],i)=>({id:i+1,quantity,gross,classification,...terms}));
 return assess({day,state,policy:{...fixture,state,collection:'collect',registration:'Registered',first_eligible_cent:0,
   rounding:'combined',shipping_base:'excluded',fee_base:'excluded',...overrides},address:{...fixture,state,rates:[{level:'combined',code:'fixture',ppm:60000}]},
   subtotal:lines.reduce((a,l)=>a+l.gross,0),shipping:0,fee:0,lines},{historicalReport:true});
}
test('Washington government street matches reconcile two $500,000 reports and reject the wrong street',async()=>{
 const taxes=[];
 for(const [city,address_line_1,postal_code,code] of [['Spokane','808 W Spokane Falls Boulevard','99201','3210'],['Seattle','600 Fourth Avenue','98104','1726']]){
   const street={address_line_1,postal_code,city,state:'WA',country:'US'};
   const xml=await readFile(new URL('./fixtures/tax/'+city.toLowerCase()+'-q42026.xml',import.meta.url),'utf8');
   const district=washingtonResult(xml,day,street,code);
   const report=await calculateAdminOrder({day,state:'WA',district,subtotal:'500000.00',shipping:0,fee:0,
     policy:{...fixture,state:'WA',collection:'collect',registration:'Registered',first_eligible_cent:0,rounding:'combined'},
     products:{1:{...fixture,form:'bar',treatment:'taxable',metal:'gold',catalog_sku:'bar',catalog_name:'Gold bar',catalog_weight:1}},
     lines:[{id:1,sku:'bar',name:'Gold bar',weight:1,metal:'gold',quantity:1,gross:'500000.00'}]});
   assert.equal(report.status,'calculated');assert.equal(report.breakdown.reduce((total,r)=>total+r.cents,0),report.tax);
   taxes.push(report.tax);
   assert.throws(()=>washingtonResult(xml,day,{...street,address_line_1:'123 Unverified Street'},code));
 }
 assert.deepEqual(taxes,[4550000,5275000]);assert.equal(taxes[1]-taxes[0],725000);
});
test('Washington street spelling aliases preserve conflicting boundary evidence',()=>{
 const sample=Buffer.from('600,602,E,4TH AVE,WA,98104,1822,Q42026,1726,Y,,\n');
 const a={address_line_1:'600 Fourth Avenue',city:'Seattle',state:'WA',postal_code:'98104'};
 assert.equal(washingtonStreetCode(sample,a),'1726');
 assert.throws(()=>washingtonStreetCode(Buffer.concat([sample,Buffer.from('600,602,E,FOURTH AVE,WA,98104,1822,Q42026,9999,N,,\n')]),a));
 assert.throws(()=>washingtonStreetCode(sample,{...a,address_line_1:'600 Fourth Hill Avenue'}));
});
test('Florida counts only foreign coins sold away from face, with a strict $500 threshold',async()=>{
 const foreign=coin({value_test:'fl_foreign_coin_group',issuing_country:'CA',denomination_currency:'CAD',denomination_cents:500});
 const dateRate={d:day,FXUSDCAD:{v:'1.2500'}};
 const rates=await completeOrderMarketInputs('FL',{s:foreign},day,false,async()=>({ok:true,json:async()=>({observations:[dateRate]})}));
 const silver=rates.s;assert.equal(silver.face_usd_cents,400);assert.equal(silver.face_fx_observed_on,day);
 assert.equal(run('FL',[[50000,silver],[150000,coin()] , [500000,coin({form:'bar'})]]).taxable,50000);
 assert.equal(run('FL',[[50001,silver]]).taxable,0);
 assert.equal(run('FL',[[49500,silver],[501,silver]]).taxable,0);
 assert.equal(run('FL',[[50000,silver],[400,silver]]).taxable,50000);
 assert.throws(()=>run('FL',[[50000,foreign]]),/conversion/);
 assert.throws(()=>run('FL',[[10501,silver,2]]),/individual/);
});
test('five states apply fair market comparisons in the currency of the coin, per individual coin',()=>{
 for(const state of ['MI','MO','NC','PA','WV']){
   const base=coin({value_test:'fair_market_above_face',denomination_cents:500,denomination_currency:'CAD'});
   for(const [price,expected] of [[499,9000],[500,9000],[501,0]]){
     const classified={...base,coin_valuation:{day,currency:'CAD',unit_cents:price,source:fixture.source}};
     const r=run(state,[[9000,classified,3]]);
     assert.equal(r.taxable,expected,state);assert.equal(r.lines[0].coin_valuation.unit_cents,price);
   }
   assert.throws(()=>run(state,[[9000,base]]),/fair market/);
   assert.throws(()=>run(state,[[9000,{...base,coin_valuation:{day,currency:'USD',unit_cents:500,source:fixture.source}}]]),/conversion/);
 }
});
test('Louisiana online proof purchases use the price of each coin and include exactly $1,000',()=>{
 const proof=coin({value_test:'la_online_numismatic'});
 assert.equal(run('LA',[[200000,proof,2]]).taxable,0);
 assert.equal(run('LA',[[200002,proof,2]]).taxable,200002);
 assert.throws(()=>run('LA',[[200001,proof,2]]),/individual/);
});
test('California uses the actual qualified selling price and separately checks the seller',()=>{
 const policy={first_eligible_cent:200000,ca_commodity_registration:'registration_not_required'};
 assert.equal(run('CA',[[199999,coin()]],policy).taxable,199999);
 assert.equal(run('CA',[[200000,coin()]],policy).taxable,0);
 assert.equal(run('CA',[[200001,coin()]],{...policy,ca_commodity_registration:'required_unregistered'}).taxable,200001);
 assert.throws(()=>run('CA',[[200000,coin()]],{first_eligible_cent:200000}),/seller eligibility/);
});
test('NY proof coin tests its actual premium; kilogram caps preserve mass and fineness uncertainty',async()=>{
 const record={verified_on:day,approval:'approved',version:1,source:'https://example.invalid/test',valid_from:'2026-01-01',valid_until:'2026-12-31'};
 const input=subtotal=>({day,state:'NY',subtotal,shipping:0,fee:0,investment:true,lines:[{id:1,quantity:1,gross:subtotal}],
   policy:{...record,state:'NY',collection:'collect',registration:'Registered',ny_dealer_status:'registered',first_eligible_cent:100001,store_minimum:true,shipping_base:'full_if_taxable',fee_base:'full_if_taxable',rounding:'combined'},
   address:{...record,state:'NY',rates:[{level:'combined',code:'fixture',ppm:88750}]}});
 const {completeNyMarketInputs}=await import('../server/tax/bullionMarket.js');
 const source='https://www.ausecure.com/gold-market-close-nov-25-2026/';
 const html='<link rel="canonical" href="'+source+'" />5:00 PM ET close on Nov 25, 2026.<h3>Gold</h3><p class="p n">$3,600.00</p><h3>Silver</h3><p class="p n">$40.00</p>';
 const fixture={...record,treatment:'eligible',origin:'catalog_policy_release_2026_11_26',metal:'gold'};
 const rules=await completeNyMarketInputs({bar:{...fixture,catalog_weight:32.15,form:'bar',catalog_sku:'GOTS-834790'},
   proof:{...fixture,catalog_weight:1,form:'coin',catalog_sku:'GOTS-GBP-1OZ-RY-001'}},day,async()=>({ok:true,text:async()=>html}));
 const calc=(rule,amount)=>{const q=input(amount);q.lines[0].classification=rule;return assess(q);};
 assert.equal(calc(rules.proof,414000).tax,0);assert.ok(calc(rules.proof,414001).tax>0);
 const cap=n=>Number(360000n*115n*BigInt(n)/(100n*311034768n));
 assert.equal(calc(rules.bar,cap(9999000000)).tax,0);
 assert.throws(()=>calc(rules.bar,cap(9999000000)+1),/exact fine weight/);
 assert.ok(calc(rules.bar,cap(10000000000)+1).tax>0);
});
test('Nevada uses the selling price relative to each coin denomination',()=>{
 const eagle=coin({value_test:'nv_coin_face_premium',denomination_cents:5000,denomination_currency:'USD'});
 assert.equal(run('NV',[[15000,eagle,2]]).taxable,0);
 assert.equal(run('NV',[[15002,eagle,2]]).taxable,15002);
 assert.throws(()=>run('NV',[[15001,eagle,2]]),/individual/);
});
test('November Alaska street jurisdictions retain borough and city caps and Montana uses whole-county exclusions',async()=>{
 const {regionalEvidence,resolveRegionalEvidence}=await import('../server/tax/regionalEvidence.js');
 const {businessDay}=await import('../shared/bullionMinimums.js');
 const when='2026-11-27';
 const geo=(county,place)=>({county:{geoid:county},municipality:place?{geoid:place}:null});
 const {confirmDestination}=await import('../server/tax/destinationRates.js');
 const streets=JSON.parse(await readFile(new URL('./fixtures/tax/alaska-montana-civic-streets.json',import.meta.url),'utf8'));
 const expected={Ketchikan:'member_general_rates',Billings:'outside_resort_areas',Anchorage:'no_general_retail_tax'};
 for(const civic of streets){
   const verify=(address,date)=>confirmDestination(address,date,async url=>{
     assert.equal(new URL(url).hostname,'geocoding.geo.census.gov');
     return {ok:true,json:async()=>({result:{addressMatches:civic.matches}})};
   });
   const actual=await resolveRegionalEvidence(civic.address,when,verify);
   assert.equal(actual.scope,expected[civic.address.city]);
   await assert.rejects(resolveRegionalEvidence({...civic.address,address_line_1:'999 Wrong Street'},when,verify));
 }
 const ketchikan=geo('02130','0238970');
 const city=regionalEvidence('AK',when,ketchikan);
 assert.deepEqual(city.rates.map(r=>[r.code,r.ppm,r.caps.per_item.limit_cents]),[['9038',25000,200000],['9037',30000,200000]]);
 const taxableBar=coin({form:'bar',treatment:'taxable',valid_from:when,valid_until:when,verified_on:when});
 const alaskaOrder=(quantity,district,over={})=>assess({state:'AK',day:when,subtotal:50000000,shipping:0,fee:0,
   policy:{...taxableBar,state:'AK',collection:'collect',rounding:'component',first_eligible_cent:0,shipping_base:'full_if_taxable'},
   lines:[{id:1,gross:50000000,quantity,classification:taxableBar}],
   address:{...taxableBar,state:'AK',rates:district,cap_basis:'arsstc_monthly_retail'},...over},{historicalReport:true});
 assert.equal(alaskaOrder(1,city.rates).tax,11000);
 assert.deepEqual(alaskaOrder(2,city.rates).breakdown.map(r=>[r.base_cents,r.cents]),[[400000,10000],[400000,12000]]);
 const narrower=city.rates.map(r=>({...r,caps:{...r.caps,per_transaction:{...r.caps.per_transaction,limit_cents:250000}}}));
 assert.equal(alaskaOrder(2,narrower).tax,13750);
 assert.throws(()=>alaskaOrder(1,city.rates,{shipping:1000}),/ancillary/);
 assert.throws(()=>alaskaOrder(1,city.rates.map(r=>({...r,caps:{}}))),/local Alaska tax cap/);
 assert.ok(city.rates.every(r=>r.caps.per_transaction.limit_cents===null));
 assert.equal(regionalEvidence('AK',when,geo('02020','0203000')).scope,'no_general_retail_tax');
 assert.equal(regionalEvidence('AK',when,geo('02100',null)),null);
 assert.equal(regionalEvidence('AK',when,geo('02130','0200000')),null);
 assert.equal(regionalEvidence('AK','2026-12-01',ketchikan),null);
 assert.equal(regionalEvidence('MT',when,geo('30111','3006550')).scope,'outside_resort_areas');
 for(const county of ['30031','30009','30029','ZZZZZ'])assert.equal(regionalEvidence('MT',when,geo(county,null)),null);
 const review=await calculateAdminOrder({review:'Nationwide rules pending.',day:businessDay(),regional_destination:{state:'AK'}},{localEvidence:async()=>city});
 assert.equal(review.status,'review');assert.equal(review.tax,undefined);assert.deepEqual(review.local_evidence,city);
});
test('sale evidence changes the classification of the same item without leaking it across states or orders',()=>{
 const item=(test,terms={},extra={})=>[200000,coin({value_test:test,catalog_sku:'AGE-1OZ-BU-RY',...extra}),1,terms];
 const proof={catalog_sku:'GOTS-GBP-1OZ-RY-001'};
 const basis=(basis,fields={})=>({sale_evidence:{id:19,document:'tax-evidence',basis,...fields}});
 for(const [state,rule,yes,no] of [
   ['ID','id_monetized_sale','ordinary_coin_sale','jewelry_or_art_manufacture'],
   ['AL','al_metal_pricing','metal_pricing','numismatic_pricing'],
   ['CT','ct_proof_coin','rare_or_antique','ordinary_collectible'],
   ['OK','ok_proof_coin','investment_sale','noninvestment_collectible'],
   ...['AR','KY','MS'].map(s=>[s,'sovereign_commodity_bar','sovereign_use_metal_price','no_qualifying_sovereign_use'])
 ]){
   const positive=run(state,[item(rule,basis(yes))]);assert.equal(positive.taxable,0,state);
   assert.equal(positive.lines[0].sale_evidence.id,19);
   assert.equal(run(state,[item(rule,basis(no))]).taxable,200000,state);
   assert.throws(()=>run(state,[item(rule,{special_terms:true})]),/Verify|Review/,state);
 }
 const remote=run('ID',[item('id_monetized_sale',{special_terms:true})],{collection:'no_obligation',remote_basis:'below_remote_threshold'});
 assert.deepEqual([remote.tax,remote.exempt,remote.unclassified,remote.taxable,remote.base],[0,0,200000,0,null]);
 assert.match(remote.lines[0].evidence_needed,/intended use/);
 assert.equal(run('AR',[item('sovereign_commodity_bar',basis('sovereign_use_collectible_price'))]).taxable,0);
 assert.equal(run('KY',[item('sovereign_commodity_bar',basis('sovereign_use_collectible_price'))]).taxable,200000);
 assert.equal(run('ID',[item('id_monetized_sale',{special_terms:false})]).taxable,0);
 for(const [state,rule] of [['AL','al_metal_pricing'],['NJ','nj_coin_alternatives']]){
   assert.equal(run(state,[item(rule,{metal_priced:true,special_terms:false})]).taxable,0);
   assert.throws(()=>run(state,[item(rule,{metal_priced:true,special_terms:true})]),/Verify/);
   assert.throws(()=>run(state,[item(rule,{metal_priced:true,special_terms:false},proof)]),/Verify/);
 }
 for(const [value,expected] of [[99999,200000],[100000,0],[100001,0]]){
   assert.equal(run('NJ',[item('nj_coin_alternatives',basis('numismatic_pricing',{fmv_cents:value,valuation_day:day}),proof)]).taxable,expected);
 }
 assert.throws(()=>run('NJ',[item('nj_coin_alternatives',basis('numismatic_pricing',{fmv_cents:100000,valuation_day:'2026-11-25'}))]),/individual coin value/);
 assert.throws(()=>run('NJ',[item('id_monetized_sale',{special_terms:false})]),/another jurisdiction/);
});
test('dated product pack applies over the live eight-listing baseline and preserves unresolved local decisions',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table auth.users(id uuid primary key);create table admin_users(user_id uuid primary key);
 create table checkout_quotes(id uuid primary key,user_id uuid,status text,expires_at timestamptz,updated_at timestamptz,subtotal numeric,shipping_amount numeric,card_surcharge numeric,line_items jsonb,spot_snapshot jsonb);
 create table orders(id bigint generated always as identity primary key,order_number text,user_id uuid,status text,first_name text,last_name text,email text,phone text,payment_method text,subtotal numeric,payment_surcharge numeric,shipping_amount numeric,total numeric,insurance_amount numeric default 0,spot_snapshot jsonb,price_locked_until timestamptz,shipping_address jsonb,customer_notes text,payment_status text default 'unpaid',paid_at timestamptz,created_at timestamptz default now());
 create table products(id bigint primary key,is_active boolean,inventory_count int,sku text,name text,metal text,metal_weight_oz numeric);
 create table order_items(order_id bigint,product_id bigint,sku text,product_name text,metal text,metal_weight_oz numeric,quantity int,unit_price numeric,line_total numeric,pricing_snapshot jsonb);
 create function private.next_customer_order_number() returns text language sql as $$select 'DEMO-1'::text$$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261127005544_tax_registration_profiles.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261127010440_tax_dealer_confirmation.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261127013002_nationwide_tax_compliance.sql',import.meta.url),'utf8'));
 await db.exec("insert into products values(902,true,2,'AGE-1OZ-BU-RY','1 oz American Gold Eagle BU (Random Year)','gold',1)");
 await db.exec(`insert into products values
  (903,true,2,'APMEX-1OZ-TEP','1 oz APMEX Gold Bar (TEP)','gold',1),
  (904,true,2,'GOTS-834790','1 Kilogram Gold Bar – 999.9 Fine Gold (Random Brand)','gold',32.15),
  (905,true,2,'GOTS-GBP-1OZ-RY-001','1 oz American Gold Buffalo Proof Coin (Random Year) - .9999 Fine Gold','gold',1),
  (906,true,2,'MAPLE-1OZ-BU-RY','1 oz Canadian Gold Maple Leaf BU (Random Year)','gold',1),
  (907,true,2,'PAMP-1OZ-FORTUNA-ASSAY','1 oz PAMP Suisse Lady Fortuna Gold Bar (In Assay)','gold',1),
  (908,true,2,'RAND-0033','1 oz Rand Refinery Loxodonta Gold Bar – .9999 Fine Gold','gold',1),
  (909,true,2,'SML-1OZ-BU-RY','1 oz Canadian Silver Maple Leaf Coin BU (Random Year)','silver',1)`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261127015640_reviewed_bullion_catalog.sql',import.meta.url),'utf8'));

 const migration=async filename=>readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8');
 await db.exec(await migration('20261127025232_verified_bullion_products.sql'));
 const counts=async(d=day,reporting=true)=>(await db.query(`select state,count(*) filter(where rule->>'approval'='approved' and (rule->>'valid_until')::date>=$1)::int n
   from private.tax_states cross join products cross join lateral (select private.${reporting?'tax_report_version':'tax_version'}(state,'product',products.id::text,$1) rule) v group by state`,[d])).rows;
 assert.equal((await counts(day,false)).reduce((sum,r)=>sum+r.n,0),137);
 for(const name of ['20261127033006_remote_collection_history.sql','20261127034914_remote_order_threshold.sql'])await db.exec(await migration(name));
 const reporting=await migration('20261127051000_admin_order_tax_report.sql');
 await db.exec(reporting);
 const forward=await migration('20261127051001_prospective_admin_tax.sql');
 await db.exec(forward.split('-- Scheduler authentication')[0]);
 const pack=await migration('20261127051002_reviewed_catalog_tax_conditions.sql');await db.exec(pack);
 const policyCount=await db.query("select count(*)::int n from private.tax_states s where private.tax_report_version(s.state,'policy','state',$1)->>'approval'='approved'",[day]);
 assert.equal(policyCount.rows[0].n,45);
 const actor='00000000-0000-4000-8000-000000000009';await db.query('insert into admin_users(user_id) values($1)',[actor]);
 const coverage=async()=>(await db.query('select public.tax_admin_rule_coverage($1,$2) c',[actor,day])).rows[0].c;
 const readiness=await coverage();
 assert.deepEqual([readiness.destinations,readiness.policies,readiness.product_reviews,readiness.product_total],[51,45,351,408]);
 assert.equal(readiness.remaining.find(s=>s.state_code==='CO').pending.length,8);
 await assert.rejects(db.query('select public.tax_admin_rule_coverage(null,$1)',[day]),/Admin required/);
 await db.exec("update products set name='Changed specification' where id=902");
 assert.ok((await coverage()).product_reviews<351);
 await db.exec("update products set name='1 oz American Gold Eagle BU (Random Year)' where id=902");
 const result=await counts();const byState=Object.fromEntries(result.map(r=>[r.state,r.n]));
 for(const state of ['MI','MO','NC','PA','WV','FL','NY','OH','UT','RI','IN','ND','VA'])assert.equal(byState[state],8,state);
 assert.equal(byState.CO,0);assert.equal(byState.AK,0);assert.equal(byState.CT,7);
 assert.equal(result.reduce((sum,r)=>sum+r.n,0),351);
 assert.equal((await counts('2026-12-08')).find(r=>r.state==='FL').n,6);
 assert.equal((await db.query("select private.tax_report_version('FL','product','909',$1)->>'value_test' t",[day])).rows[0].t,'fl_foreign_coin_group');
 console.log('Remaining by state:',result.filter(r=>r.n<8).map(r=>r.state+' '+(8-r.n)).sort().join(', '));
 console.log('Dated product rules:',result.reduce((sum,r)=>sum+r.n,0),'of 408');
 const next='2026-11-27';
 assert.equal((await counts(next,false)).reduce((sum,r)=>sum+r.n,0),137);
 assert.equal((await db.query("select private.tax_version('ID','policy','state',$1) v",[next])).rows[0].v,null);
 const todayCoverage=(await db.query('select public.tax_admin_rule_coverage($1,$2) c',[actor,next])).rows[0].c;
 assert.deepEqual([todayCoverage.policies,todayCoverage.product_reviews,todayCoverage.product_total],[48,376,408]);
 assert.equal(todayCoverage.state_only_reviews,32);
 const virginia=(await db.query("select private.tax_remote_order_bound('VA',private.tax_report_version('VA','policy','state',$1)||jsonb_build_object('shipping_disabled',false),'{}',$1,null) p",[next])).rows[0].p;
 assert.equal(virginia.collection,'exempt_merchandise');
 console.log('November 27 product classifications:',todayCoverage.product_reviews,'of',todayCoverage.product_total,'and',todayCoverage.policies,'destination policies');
 const doc='00000000-0000-4000-8000-000000000010';
 await db.query("insert into private.tax_documents(id,state,kind,display_name,object_path,actor) values($1,'ID','exemption','Receipt','test',$2)",[doc,actor]);
 await db.exec("update private.tax_report_start set starts_at='2026-11-27T05:00:00Z';update private.tax_states set registration='Not Registered',physical=false,disabled=false,effective=null,collect_from=null,registration_due=null,active_confirmed_on=null where state in ('ID','CA','AZ')");
 await db.exec(`insert into orders(id,created_at,shipping_address,subtotal,shipping_amount,payment_surcharge,total) overriding system value values(40,'2026-11-27T09:00:00Z','{"state":"ID"}',60000,0,0,60000);
 insert into order_items(order_id,product_id,sku,product_name,metal,metal_weight_oz,quantity,unit_price,line_total,pricing_snapshot)
 values(40,902,'AGE-1OZ-BU-RY','1 oz American Gold Eagle BU (Random Year)','gold',1,1,60000,60000,'{"spot":60000,"premium_percent":0,"premium_fixed":0,"price_mode":"dynamic"}')`);
 const placed=async state=>(await db.query("select private.tax_remote_order_bound($1,private.tax_report_version($1,'policy','state',$2),'{}',$2,40) v",[state,next])).rows[0].v;
 const single=await placed('ID');assert.equal(single.collection,'no_obligation');assert.equal(single.receipts_upper_bound_cents,6000000);assert.equal(single.transactions_upper_bound,1);
 const quote=(await db.query("select private.tax_remote_order_bound('ID',private.tax_report_version('ID','policy','state',$1),$2,$1,null) v",[next,{subtotal:60000,shipping_amount:0,card_surcharge:0}])).rows[0].v;
 assert.equal(quote.collection,'review');
 await db.exec("update orders set total=100000 where id=40");assert.equal((await placed('ID')).collection,'no_obligation');
 await db.exec("update orders set total=100000.01 where id=40");assert.equal((await placed('ID')).collection,'review');
 const fingerprint=async()=>(await db.query('select private.tax_order_fact_hash(o) h,private.tax_report_input_hash(o) r from orders o where id=40')).rows[0];
 const before=await fingerprint();
 const localScope=async state=>(await db.query('select private.tax_order_state_scope(o,$1,$2) s from orders o where id=40',[state,next])).rows[0].s;
 assert.equal((await localScope('CO')).scope,'state_administered_bullion_exemption');
 assert.equal((await localScope('AZ')).scope,'consumer_bullion_exemption');
 await db.exec("update order_items set metal_weight_oz=2 where order_id=40");assert.equal(await localScope('CO'),null);
 await db.exec("update order_items set metal_weight_oz=1 where order_id=40");
 const save=(user,state,product,basis,document)=>db.query('select public.tax_record_item_fact($1,$2,40,$3,$4,$5,null)',[user,state,product,basis,document]);
 await assert.rejects(save(null,'ID',902,'ordinary_coin_sale',doc),/Admin required/);
 await assert.rejects(save(actor,'ID',902,'wrong',doc),/Invalid sale evidence/);
 await assert.rejects(save(actor,'ID',903,'ordinary_coin_sale',doc),/mismatch/);
 await save(actor,'ID',902,'ordinary_coin_sale',doc);const after=await fingerprint();assert.equal(after.h,before.h);assert.notEqual(before.r,after.r);
 await db.exec("update order_items set pricing_snapshot='{}' where order_id=40");assert.notEqual((await fingerprint()).h,before.h);
 await db.exec(`update orders set shipping_address='{"state":"CA"}',subtotal=50000,total=50000 where id=40`);
 assert.match((await placed('CA')).review_reason,/Related-party/);
 await db.query("update private.tax_documents set state='CA' where id=$1",[doc]);
 const related=(prior,current)=>db.query("select public.tax_record_related_receipts($1,'CA',$2,$3,$4,$5,'registration_not_required')",[actor,next,prior,current,doc]);
 const noRelated=(await fingerprint()).r;await related(45000000,0);assert.notEqual((await fingerprint()).r,noRelated);assert.equal((await placed('CA')).collection,'no_obligation');
 await related(45000001,0);assert.equal((await placed('CA')).collection,'no_obligation');
 await related(0,45000001);assert.equal((await placed('CA')).collection,'review');
 await related(50000001,0);assert.equal((await placed('CA')).collection,'review');
 }finally{await db.close();}
});
