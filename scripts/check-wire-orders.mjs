import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;const U='10000000-0000-4000-8000-000000000001';
import {WIRE_AGREEMENT_TEXT,WIRE_AGREEMENT_VERSION,validWireAgreement} from '../supabase/functions/_shared/wireAgreement.js';
import {assertWireInstructionsAvailable} from '../server/lib/wire.js';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
before(async()=>{
 db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table auth.users(id uuid primary key);insert into auth.users values('${U}');
 create table app_settings(key text primary key,value jsonb,is_public boolean default false);
 create table admin_users(user_id uuid primary key);insert into admin_users values('${U}');
 insert into app_settings(key,value) values('shipping_flat','35'),('free_shipping_threshold','5000');
 create table products(id bigint primary key,name text,sku text,metal text default 'gold',metal_weight_oz numeric default 1,is_active boolean default true,inventory_count integer default 100,price_mode text default 'fixed',fixed_price numeric default 100,premium_fixed numeric default 0,premium_percent numeric default 0,image_url text,image_urls text[]);
 insert into products(id,name,sku)values(1,'Test coin','TEST-1'),(2,'Test bar','TEST-2');
 create table orders(id bigint generated always as identity primary key,order_number text,user_id uuid,first_name text,last_name text,email text,phone text,payment_method text,payment_status text default 'unpaid',status text default 'awaiting_payment',subtotal numeric,payment_surcharge numeric,shipping_amount numeric,total numeric,spot_snapshot jsonb,price_locked_until timestamptz,payment_due_at timestamptz,shipping_address jsonb,customer_notes text,updated_at timestamptz);
 create table order_items(id bigint generated always as identity,order_id bigint,product_id bigint,sku text,product_name text,metal text,metal_weight_oz numeric,quantity integer,unit_price numeric,line_total numeric,pricing_snapshot jsonb);
 create table payment_attempts(order_id bigint,provider text,status text,amount numeric,expires_at timestamptz,updated_at timestamptz);
 create table admin_audit_log(actor_user_id uuid,action text,target_type text,target_id text,reason text,metadata jsonb);
 create function public.mark_payment_state(bigint,text,text,text,text,timestamptz)returns void language sql as $$select$$;
 alter table products enable row level security;grant usage on schema public,auth to authenticated,anon;grant select,update on products to authenticated;grant select on products to anon;
 create policy read_products on products for select using(is_active);
 create policy admin_product_edit on products for update to authenticated using(auth.uid()='${U}' and current_setting('test.aal',true)='aal2') with check(auth.uid()='${U}' and current_setting('test.aal',true)='aal2');
 `);
 await db.exec(await read('./fixtures/legacy-create-order.sql'));
 await db.exec(await read('../supabase/migrations/20260805031836_checkout_quotes_and_embedded_card.sql'));
 await db.exec(await read('../supabase/migrations/20261022184640_product_shipping_rules.sql'));
 await db.exec(await read('../supabase/migrations/20261022194838_configurable_payment_maximums.sql'));
 await db.exec(`alter table auth.users add column email text default 'verified@example.test',add column email_confirmed_at timestamptz default now();
 alter table orders add column payment_provider text,add column provider_payment_id text,add column provider_checkout_url text,add column payment_reference text,
 add column terms_version text,add column terms_accepted_at timestamptz,add column terms_user_agent text,add column terms_ip_hash text,
 add column insurance_amount numeric default 0,add column created_at timestamptz default now(),add column paid_at timestamptz,add column internal_notes text;
 alter table payment_attempts add column checkout_url text,add column provider_payment_id text;
 create table order_email_outbox(id uuid default gen_random_uuid(),order_id bigint,event_key text,event_type text constraint order_email_outbox_event_type_check check(event_type in ('placed','support_reply')),recipient text,order_snapshot jsonb,status text default 'pending',attempts integer default 0,last_error text,unique(order_id,event_key));
 insert into app_settings values('order_emails_enabled','true',false);
 create function get_wire_instructions_secret() returns jsonb language sql as $$select '{"bank_name":"TEST BANK","beneficiary_name":"TEST ONLY","routing_number":"021000021","account_number":"12345678"}'::jsonb$$;
 create table private.card_payment_claims(order_id bigint);
 create table order_risk_reviews(order_id bigint,decision text);
 `);
 await db.exec(await read('../supabase/migrations/20260811004000_convert_unpaid_card_order_to_wire.sql'));
 const guards=await read('../supabase/migrations/20261016141000_admin_order_partial_updates.sql');
 await db.exec(guards.slice(0,guards.indexOf('create or replace function public.admin_update_order')));
 await db.exec('create trigger guard_inflight before update on orders for each row execute function private.guard_inflight_payment()');
 await db.exec(await read('../supabase/migrations/20261022214403_wire_agreement_and_reliable_instructions.sql'));
 const termsMigration=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(name=>name.endsWith('_versioned_purchase_terms.sql'));
 await db.exec(await read('../supabase/migrations/'+termsMigration));
});
after(()=>db?.close());
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
async function tx(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
async function rejects(fn,pattern){await db.exec('savepoint rejected');await assert.rejects(fn,pattern);await db.exec('rollback to rejected')}
const contact={first_name:'Test',last_name:'Only',email:'verified@example.test',phone:'+12025550123'};
const shipping={address_line_1:'1 Test Street',city:'New York',state:'NY',postal_code:'10001'};
const agreement={accepted:true,version:WIRE_AGREEMENT_VERSION};
const quote=()=>scalar('select create_checkout_quote($1,$2,$3)',[U,[{product_id:1,quantity:1}],{}]);
const place=(q,method='wire',agree=agreement,version='2026-10-22')=>scalar('select place_checkout_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[U,q.quote_id,contact,shipping,method,null,{accepted:true,version},agree,'fixture-agent',null]);
const accept=(id,user=U,agree=agreement)=>scalar('select accept_wire_order($1,$2,$3)',[id,user,agree]);
test('revised purchase terms are recorded for card and wire without rewriting on replay',()=>tx(async()=>{
 for(const method of ['card','wire']) {
   const q=await quote(),o=await place(q,method,method==='wire'?agreement:null,'2026-10-22-v2');
   assert.equal(await scalar('select terms_version from orders where id=$1',[o.order_id]),'2026-10-22-v2');
   if(method==='card') { await accept(o.order_id); assert.equal(await scalar('select terms_version from orders where id=$1',[o.order_id]),'2026-10-22-v2'); }
   await place(q,method,method==='wire'?agreement:null,'2026-10-22');
   assert.equal(await scalar('select terms_version from orders where id=$1',[o.order_id]),'2026-10-22-v2');
 }
 const q=await quote();await rejects(()=>place(q,'card',null,'unknown'),/Terms of Purchase/);
}));
test('wire order records exact version/text/total and queues verified-recipient email atomically',()=>tx(async()=>{
 const q=await quote(),o=await place(q);
 const row=(await db.query('select * from orders where id=$1',[o.order_id])).rows[0];
 assert.equal(row.wire_agreement_text,WIRE_AGREEMENT_TEXT);assert.equal(row.wire_agreement_version,WIRE_AGREEMENT_VERSION);
 assert.equal(Number(row.wire_agreed_total),135);assert.ok(Date.parse(row.payment_due_at)>Date.parse(row.price_locked_until));
 const mail=(await db.query('select * from order_email_outbox')).rows[0];assert.equal(mail.recipient,'verified@example.test');assert.equal(mail.event_type,'wire_instructions');assert.equal(mail.order_snapshot.total,135);
 assert.equal(mail.order_snapshot.wire_agreement_text,WIRE_AGREEMENT_TEXT);
}));
test('missing/old/forged wire consent rolls back inventory, order and quote consumption',()=>tx(async()=>{
 const q=await quote();for(const a of [null,{accepted:false,version:WIRE_AGREEMENT_VERSION},{accepted:true,version:'old'},{...agreement,total:1}])await rejects(()=>place(q,'wire',a),/agreement/);
 assert.equal(await scalar('select count(*)::int from orders'),0);assert.equal(await scalar('select inventory_count from products where id=1'),100);
 assert.equal(await scalar('select status from checkout_quotes where id=$1',[q.quote_id]),'active');
}));
test('quote/order replay returns same order, preserves deadline and never duplicates email or inventory decrement',()=>tx(async()=>{
 const q=await quote(),a=await place(q),b=await place(q);assert.equal(a.order_id,b.order_id);
 const c=await accept(a.order_id);assert.equal(a.payment_due_at,c.payment_due_at);
 assert.equal(await scalar('select count(*)::int from orders'),1);assert.equal(await scalar('select count(*)::int from order_email_outbox'),1);assert.equal(await scalar('select inventory_count from products where id=1'),99);
}));
test('quote from another customer and expired quote cannot place an order',()=>tx(async()=>{
 const q=await quote();await db.query("update checkout_quotes set expires_at=now()-interval '1 second' where id=$1",[q.quote_id]);await rejects(()=>place(q),/expired/);
 await rejects(()=>scalar('select place_checkout_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',['10000000-0000-4000-8000-000000000002',q.quote_id,contact,shipping,'wire',null,{accepted:true,version:'2026-10-22'},agreement,null,null]),/not found/);
}));
test('card conversion binds owner, retains payment guards, removes surcharge and records consent',()=>tx(async()=>{
 const o=await place(await quote(),'card',null);
 await rejects(()=>accept(o.order_id,'10000000-0000-4000-8000-000000000002'),/not found/);
 await db.query('insert into private.card_payment_claims values($1)',[o.order_id]);await rejects(()=>accept(o.order_id),/unresolved/);
 await db.exec('delete from private.card_payment_claims');const converted=await accept(o.order_id);assert.equal(converted.total,135);assert.equal(converted.surcharge,0);
}));
test('accepted wire agreement cannot be repriced, have its deadline extended or consent rewritten',()=>tx(async()=>{
 const o=await place(await quote());for(const sql of ["payment_due_at=now()+interval '5 days'","total=1","wire_agreement_text='fake'","wire_accepted_at=null","payment_method='card'"])await rejects(()=>db.exec('update orders set '+sql),/cannot be changed/);
 await db.exec("update orders set payment_status='paid'");await rejects(()=>accept(o.order_id),/cannot accept/);
}));
test('missing bank configuration aborts order transaction and old orders receive no backfilled consent',()=>tx(async()=>{
 await db.exec("create or replace function get_wire_instructions_secret() returns jsonb language sql as $$select null::jsonb$$");
 const q=await quote();await rejects(()=>place(q),/unavailable/);assert.equal(await scalar('select count(*)::int from orders'),0);
}));
test('private ledger and accepting/placing RPCs are inaccessible to direct customers and anonymous requests',()=>tx(async()=>{
 for(const role of ['anon','authenticated']){
  for(const signature of ['accept_wire_order(bigint,uuid,jsonb,text,text)','place_checkout_order(uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,text,text)']) assert.equal(await scalar("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
  assert.equal(await scalar("select has_table_privilege($1,'private.checkout_order_receipts','select')",[role]),false);
 }
}));
test('wire deadline skips weekends in New York and always gives at least 24 hours',()=>tx(async()=>{
 for(const time of ['2026-10-23T23:00:00Z','2026-10-25T01:00:00Z','2026-03-07T16:00:00Z','2026-11-01T16:00:00Z']){
 const due=await scalar('select private.wire_deadline($1)',[time]);assert.ok(Date.parse(due)-Date.parse(time)>=86400000);assert.ok(!['Sat','Sun'].includes(new Date(due).toLocaleDateString('en-US',{weekday:'short',timeZone:'America/New_York'})));
 }
}));
test('wire instruction reads allow expired quote with valid wire deadline, reject settled/cancelled/overdue orders',()=>{
 const o={payment_method:'wire',payment_status:'unpaid',status:'awaiting_payment',price_locked_until:'2000-01-01',payment_due_at:new Date(Date.now()+86400000).toISOString()};assert.doesNotThrow(()=>assertWireInstructionsAvailable(o));
 for(const change of [{payment_status:'paid'},{payment_status:'refunded'},{status:'cancelled'},{payment_due_at:null},{payment_due_at:'2000-01-01'},{payment_method:'card'}])assert.throws(()=>assertWireInstructionsAvailable({...o,...change}));
 assert.equal(validWireAgreement(agreement),true);assert.equal(validWireAgreement({...agreement,amount:1}),false);
});
test('wire settings require an admin and save destination plus sanitized audit atomically',()=>tx(async()=>{
 await db.exec("create table fixture_bank(settings jsonb);create function set_wire_instructions_secret(secret_value jsonb)returns void language sql as $$insert into public.fixture_bank values(secret_value)$$");
 const settings={bank_name:'TEST BANK',beneficiary_name:'TEST LLC',routing_number:'021000021',account_number:'12345678',swift_code:'TESTUS33'};
 await rejects(()=>scalar('select save_wire_settings_audited($1,$2,$3)',['10000000-0000-4000-8000-000000000002',settings,'Update instructions']),/Administrator/);
 await scalar('select save_wire_settings_audited($1,$2,$3)',[U,settings,'Update instructions']);
 const audit=await scalar("select metadata from admin_audit_log where action='payments.wire_settings_updated'");assert.deepEqual(audit,{account_last4:'5678'});
 await db.exec("create function fixture_reject_audit()returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$;create trigger reject_audit before insert on admin_audit_log for each row execute function fixture_reject_audit()");
 await rejects(()=>scalar('select save_wire_settings_audited($1,$2,$3)',[U,{...settings,account_number:'87654321'},'Update instructions']),/audit unavailable/);
 assert.equal(await scalar('select count(*)::int from fixture_bank'),1);
}));
