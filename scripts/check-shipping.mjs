import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {estimateShipping} from '../src/lib/shipping.js';
let db;const U='10000000-0000-4000-8000-000000000001';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
before(async()=>{
 db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table auth.users(id uuid primary key);insert into auth.users values('${U}');
 create table app_settings(key text primary key,value jsonb);
 insert into app_settings values('shipping_flat','35'),('free_shipping_threshold','5000');
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
});
after(()=>db?.close());
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
async function tx(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
const cart=[{product_id:1,quantity:1}];
const quote=()=>scalar('select create_checkout_quote($1,$2,$3)',[U,JSON.stringify(cart),'{}']);
const contact={first_name:'Test',last_name:'Only',email:'test@example.test',phone:'+12025550123'};
const address={address_line_1:'1 Test Street',city:'Test',state:'NY',postal_code:'10001'};
const orderFrom=q=>scalar('select create_order_from_quote($1,$2,$3,$4,$5,null)',[U,q.quote_id,JSON.stringify(contact),JSON.stringify(address),'card']);
test('default shipping and exact free threshold are computed by the quote RPC',()=>tx(async()=>{
 assert.equal((await quote()).shipping,35);
 await db.exec('update products set fixed_price=5000 where id=1');assert.equal((await quote()).shipping,0);
 await db.exec('update products set fixed_price=4999.99 where id=1');assert.equal((await quote()).shipping,35);
}));
test('product fee and minimum ignore forged browser shipping values',()=>tx(async()=>{
 await db.exec('update products set shipping_fee=12.50,free_shipping_minimum=150 where id=1');
 let q=await scalar('select create_checkout_quote($1,$2,$3)',[U,JSON.stringify([{...cart[0],shipping_fee:0,free_shipping_minimum:0,shipping:0,total:0}]),'{}']);assert.equal(q.shipping,12.5);
 await db.exec('update products set fixed_price=150 where id=1');assert.equal((await quote()).shipping,0);
 await db.exec('update products set free_shipping_minimum=0 where id=1');assert.equal((await quote()).shipping,0);
}));
test('mixed carts charge the highest applicable fee once using full merchandise subtotal',()=>tx(async()=>{
 await db.exec('update products set shipping_fee=10,free_shipping_minimum=150 where id=1;update products set shipping_fee=20,free_shipping_minimum=300 where id=2');
 const q=await scalar('select create_checkout_quote($1,$2,$3)',[U,JSON.stringify([...cart,{product_id:2,quantity:1}]),'{}']);assert.equal(q.subtotal,200);assert.equal(q.shipping,20);
}));
test('saved quote keeps its shipping after admin edit; refresh and legacy order use current rules',()=>tx(async()=>{
 const q=await quote();await db.exec('update products set shipping_fee=17,free_shipping_minimum=1000 where id=1');
 const o=await orderFrom(q);assert.equal(o.shipping,35);assert.equal(o.total,139);
 const refreshed=await scalar('select refresh_card_order_quote($1,$2)',[o.order_id,'{}']);assert.equal(refreshed.shipping,17);assert.equal(refreshed.card_total,121);
 const legacy=await scalar('select create_order($1,$2,$3,$4,$5,$6,null)',[U,JSON.stringify(contact),JSON.stringify(address),JSON.stringify(cart),'{}','wire']);assert.equal(legacy.shipping,17);assert.equal(legacy.total,117);
}));
test('invalid shipping settings fail at the database and authorized edits are audited',()=>tx(async()=>{
 for(const statement of ['update products set shipping_fee=-1','update products set shipping_fee=10001','update products set free_shipping_minimum=-1']){
  await db.exec('savepoint invalid');await assert.rejects(()=>db.exec(statement));await db.exec('rollback to invalid');
 }
 await db.query("select set_config('test.uid',$1,true),set_config('test.aal','aal2',true)",[U]);await db.exec('set local role authenticated;update products set shipping_fee=23 where id=1;reset role');
 assert.equal(await scalar("select count(*)::integer from admin_audit_log where action='product_shipping_updated' and actor_user_id=$1",[U]),1);
}));
test('normal users and AAL1 admin cannot alter product shipping or call private calculator',()=>tx(async()=>{
 await db.query("select set_config('test.uid',$1,true),set_config('test.aal','aal1',true)",[U]);await db.exec('set local role authenticated;update products set shipping_fee=0 where id=1;reset role');assert.equal(await scalar('select shipping_fee from products where id=1'),null);
 assert.equal(await scalar("select has_function_privilege('authenticated','private.shipping_for_cart(jsonb,numeric)','execute')"),false);
 assert.equal(await scalar("select has_function_privilege('anon','public.create_checkout_quote(uuid,jsonb,jsonb)','execute')"),false);
}));
test('cart display estimates match default, product, mixed and zero threshold rules',()=>{
 const settings={shipping_flat:35,free_shipping_threshold:5000};
 assert.equal(estimateShipping([{product:{}}],4999.99,settings),35);
 assert.equal(estimateShipping([{product:{}}],5000,settings),0);
 assert.equal(estimateShipping([{product:{shipping_fee:10,free_shipping_minimum:150}},{product:{shipping_fee:20,free_shipping_minimum:300}}],200,settings),20);
 assert.equal(estimateShipping([{product:{free_shipping_minimum:0}}],100,settings),0);
});
