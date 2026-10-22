import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;const U='10000000-0000-4000-8000-000000000001';
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
});
after(()=>db?.close());
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
async function tx(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
const cart=[{product_id:1,quantity:1}];
const quote=()=>scalar('select create_checkout_quote($1,$2,$3)',[U,JSON.stringify(cart),'{}']);
const contact={first_name:'Test',last_name:'Only',email:'test@example.test',phone:'+12025550123'};
const address={address_line_1:'1 Test Street',city:'Test',state:'NY',postal_code:'10001'};
const orderFrom=(q,method='card')=>scalar('select create_order_from_quote($1,$2,$3,$4,$5,null)',[U,q.quote_id,JSON.stringify(contact),JSON.stringify(address),method]);

const setLimits=limits=>scalar('select admin_set_payment_maximums($1,$2,$3)',[U,JSON.stringify(limits),'Adjust order maximums']);
const limits={card_order_maximum:139,wire_order_maximum:135,crypto_order_maximum:135};
async function rejects(query,pattern){await db.exec('savepoint rejected');await assert.rejects(query,pattern);await db.exec('rollback to rejected')}
test('all methods allow the exact final total and reject one cent above it',()=>tx(async()=>{
 await setLimits(limits);
 for(const method of ['card','wire','crypto']){
  const q=await quote();const o=await orderFrom(q,method);assert.equal(o.total,limits[method+'_order_maximum']);
  await db.query('update app_settings set value=to_jsonb($1::numeric) where key=$2',[limits[method+'_order_maximum']-.01,method+'_order_maximum']);
  const next=await quote();await rejects(()=>orderFrom(next,method),/payment maximum/);
  assert.equal(await scalar('select status from checkout_quotes where id=$1',[next.quote_id]),'active');
 }
}));
test('limits changed after a quote are enforced server-side; failed order does not consume stock',()=>tx(async()=>{
 const q=await quote();const before=await scalar('select inventory_count from products where id=1');
 await setLimits({...limits,card_order_maximum:100});await rejects(()=>orderFrom(q),/payment maximum/);
 assert.equal(await scalar('select inventory_count from products where id=1'),before);
 assert.equal(await scalar('select count(*)::integer from orders'),0);
}));
test('legacy checkout, method changes and repricing cannot bypass maximums',()=>tx(async()=>{
 await setLimits({...limits,card_order_maximum:500,wire_order_maximum:100});
 await rejects(()=>scalar('select create_order($1,$2,$3,$4,$5,$6,null)',[U,JSON.stringify(contact),JSON.stringify(address),JSON.stringify(cart),'{}','wire']),/payment maximum/);
 const o=await orderFrom(await quote());
 await rejects(()=>db.query("update orders set payment_method='wire',total=135 where id=$1",[o.order_id]),/payment maximum/);
 await rejects(()=>db.query('update orders set total=500.01 where id=$1',[o.order_id]),/payment maximum/);
}));
test('lowering a maximum preserves existing orders and payment/fulfillment updates',()=>tx(async()=>{
 const o=await orderFrom(await quote());await setLimits({...limits,card_order_maximum:50});
 await db.query("update orders set payment_status='paid',status='processing' where id=$1",[o.order_id]);
 assert.equal(Number(await scalar('select total from orders where id=$1',[o.order_id])),139);
}));
test('limits save atomically with audit before/after and invalid inputs leave settings unchanged',()=>tx(async()=>{
 await setLimits(limits);const log=await scalar("select metadata from admin_audit_log where action='payment.maximums_updated'");
 assert.equal(log.previous.card_order_maximum,10000);assert.deepEqual(log.limits,limits);
 for(const value of [null,'100',true,-1,0,10000001,1.001]) await rejects(()=>setLimits({...limits,card_order_maximum:value}),/maximum/);
 await rejects(()=>setLimits({...limits,unexpected:1}),/fields/);
 await rejects(()=>scalar('select admin_set_payment_maximums($1,$2,$3)',[U,JSON.stringify(limits),'']),/reason/);
 assert.equal(await scalar("select value from app_settings where key='card_order_maximum'"),139);
 assert.equal(await scalar("select count(*)::integer from admin_audit_log where action='payment.maximums_updated'"),1);
}));
test('customers cannot call the settings RPC, spoof an admin, or execute the trigger function',()=>tx(async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_function_privilege($1,'public.admin_set_payment_maximums(uuid,jsonb,text)','execute')",[role]),false);
  assert.equal(await scalar("select has_function_privilege($1,'private.enforce_order_payment_maximum()','execute')",[role]),false);
 }
 await rejects(()=>scalar('select admin_set_payment_maximums($1,$2,$3)',['10000000-0000-4000-8000-000000000002',JSON.stringify(limits),'Test reason']),/Administrator/);
}));
