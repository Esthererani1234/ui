import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const U='10000000-0000-4000-8000-000000000001', V='10000000-0000-4000-8000-000000000002', S='20000000-0000-4000-8000-000000000001', C='30000000-0000-4000-8000-000000000001';
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema private;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table public.profiles(id uuid primary key,phone text,phone_verified_at timestamptz);
 create table public.admin_users(user_id uuid primary key);
 create table public.app_settings(key text primary key,value jsonb);
 create table public.customer_sms_sessions(session_id uuid primary key,user_id uuid,phone text,purpose text,verified_at timestamptz,expires_at timestamptz);
 create table public.customer_sms_challenges(id uuid primary key,user_id uuid,session_id uuid,phone text,purpose text,provider_verify_id text,status text default 'pending',attempt_count integer default 0,expires_at timestamptz,verified_at timestamptz);
 create table public.orders(id bigint primary key,user_id uuid,total numeric,price_locked_until timestamptz,payment_method text,payment_status text,status text,payment_provider text,provider_payment_id text,paid_at timestamptz,internal_notes text,updated_at timestamptz);
 create table public.order_risk_reviews(order_id bigint primary key,decision text);
 create table public.payment_attempts(order_id bigint,provider text,provider_payment_id text,amount numeric,currency text,status text,updated_at timestamptz);
 create table public.payment_events(id bigint generated always as identity primary key,provider text,provider_event_id text,order_id bigint,event_type text,verified boolean,payload jsonb,processed_at timestamptz,unique(provider,provider_event_id));
 create function private.is_admin() returns boolean language sql as $$select false$$;
 create function private.customer_sms_verified() returns boolean language sql as $$select false$$;
 create function public.mark_payment_state(bigint,text,text,text,text,timestamptz default null) returns void language sql as $$select$$;
 alter table public.profiles enable row level security;
 alter table public.orders enable row level security;
 grant usage on schema public,private,auth to authenticated,anon;
 grant select(id,phone,phone_verified_at),update(phone) on public.profiles to authenticated;
 grant select on public.orders to authenticated;
 create policy own_profile on public.profiles to authenticated using(id=auth.uid()) with check(id=auth.uid());
 create policy own_orders on public.orders for select to authenticated using(user_id=auth.uid() and private.customer_sms_verified() or private.is_admin());
 insert into auth.users values('${U}',now(),null),('${V}',now(),null);
 insert into auth.sessions values('${S}','${U}',null);
 insert into profiles values('${U}','+12025550101',now()),('${V}','+12025550102',now());
 insert into app_settings values('customer_sms_mfa_required','true');
 insert into customer_sms_challenges values('${C}','${U}','${S}','+12025550101','signin','test-only','pending',0,now()+interval '5 minutes',null);
 insert into orders values(1,'${U}',100,now()+interval '10 minutes','card','unpaid','awaiting_payment','stripe','pi_test',null,null,now()),(2,'${V}',200,now()+interval '10 minutes','card','unpaid','awaiting_payment','stripe','pi_other',null,null,now());
 insert into payment_attempts values(1,'stripe','pi_test',100,'USD','failed',now());`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261015160910_authentication_and_payment_guards.sql',import.meta.url),'utf8'));
 await db.exec(`alter table auth.users add column created_at timestamptz default now()-interval '10 days';
 alter table profiles add column postal_code text;
 alter table app_settings add column is_public boolean default false;
 create table customer_risk_profiles(user_id uuid,status text,risk_score integer,manual_review_required boolean);
 alter table orders add column order_number text default 'TEST';
 alter table orders add column shipping_address jsonb default '{}';
 alter table orders add column tracking_number text;
 alter table orders add column created_at timestamptz default now();
 alter table order_risk_reviews add column user_id uuid;
 alter table order_risk_reviews add column risk_score integer;
 alter table order_risk_reviews add column risk_level text;
 alter table order_risk_reviews add column signals jsonb;
 alter table order_risk_reviews add column reviewed_at timestamptz;
 create table products(id bigint primary key,inventory_count integer);
 create table order_items(order_id bigint,product_id bigint,quantity integer);
 create table admin_audit_log(actor_user_id uuid,action text,target_type text,target_id text,reason text,metadata jsonb);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261015162128_fraud_review_and_admin_auditing.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261016141000_admin_order_partial_updates.sql',import.meta.url),'utf8'));
 await db.exec(`create trigger profiles_clear_changed_phone_verification before update of phone on profiles for each row execute function private.clear_changed_phone_verification();`);
 // Legacy duplicate: migration must preserve existing access without allowing a new owner.
 await db.exec(`insert into profiles(id,phone,phone_verified_at) values('10000000-0000-4000-8000-000000000003','(202) 555-0102',now());`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261022145500_unique_customer_phone_enrollment.sql',import.meta.url),'utf8'));
});
after(()=>db?.close());
async function tx(fn) {await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const claims=async(user=U,aal='aal1')=>db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:user,session_id:S,role:'authenticated',aal})]);
const event=(id='evt_test',state='paid',ref='pi_test')=>db.query(`select apply_payment_event('stripe',$1,1,'test',$2,$3,$3,'{}')`,[id,ref,state]);
test('security RPCs cannot be executed by anonymous or signed-in clients',()=>tx(async()=>{
 for(const name of ['can_enroll_customer_phone(uuid,text)','consume_security_rate_limit(text,text,integer,integer)','claim_sms_attempt(uuid,uuid,text,integer)','complete_sms_challenge(uuid,uuid,text,integer)','check_customer_session(uuid,text,boolean)','claim_card_payment(bigint,uuid,text,numeric)','apply_payment_event(text,text,bigint,text,text,text,text,jsonb)'])
 for(const role of ['anon','authenticated']) assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,name]),false);
}));
test('rate reservations enforce the limit and reset after the server window',()=>tx(async()=>{
 const results=await Promise.all(Array.from({length:12},()=>scalar("select consume_security_rate_limit('sms','test',5,3600)")));
 assert.equal(results.filter(x=>x===0).length,5);
 await db.exec("update private.security_rate_limits set started_at=now()-interval '2 hours'");
 assert.equal(await scalar("select consume_security_rate_limit('sms','test',5,3600)"),0);
}));
test('revoked, banned, mismatched sessions fail closed',()=>tx(async()=>{
 assert.equal(await scalar('select check_customer_session($1,$2,false)',[U,S]),true);
 assert.equal(await scalar('select check_customer_session($1,$2,false)',[V,S]),false);
 await db.exec(`update auth.users set banned_until=now()+interval '1 hour' where id='${U}'`);
 assert.equal(await scalar('select check_customer_session($1,$2,false)',[U,S]),false);
 await db.exec(`update auth.users set banned_until=null;delete from auth.sessions`);
 assert.equal(await scalar('select check_customer_session($1,$2,false)',[U,S]),false);
}));
test('password-only client cannot replace its enrolled phone',()=>tx(async()=>{
 await claims(); await db.exec('set local role authenticated');
 await assert.rejects(db.exec(`update profiles set phone='+12025550999' where id='${U}'`),/Verify your current phone/);
}));
test('verified phone change clears old verification and SMS sessions',()=>tx(async()=>{
 await db.exec(`insert into customer_sms_sessions values('${S}','${U}','+12025550101','signin',now(),now()+interval '1 hour')`);
 await claims();await db.exec('set local role authenticated');
 await db.exec(`update profiles set phone='+12025550999' where id='${U}'`);
 await db.exec('reset role');
 assert.equal(await scalar(`select phone_verified_at from profiles where id='${U}'`),null);
 assert.equal(await scalar('select count(*)::int from customer_sms_sessions'),0);
}));
test('OTP attempts stop at the configured maximum',()=>tx(async()=>{
 for(let i=0;i<5;i++) assert.ok(await scalar('select claim_sms_attempt($1,$2,$3,5)',[C,U,S]));
 assert.equal(await scalar('select claim_sms_attempt($1,$2,$3,5)',[C,U,S]),null);
 assert.equal(await scalar('select attempt_count from customer_sms_challenges'),5);
}));
test('expired and wrong-owner OTPs cannot be claimed or completed',()=>tx(async()=>{
 assert.equal(await scalar('select claim_sms_attempt($1,$2,$3,5)',[C,V,S]),null);
 await db.exec("update customer_sms_challenges set expires_at=now()-interval '1 second',attempt_count=1");
 assert.equal(await scalar('select claim_sms_attempt($1,$2,$3,5)',[C,U,S]),null);
 assert.equal(await scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]),false);
}));
test('OTP success is atomic and cannot be replayed',()=>tx(async()=>{
 await scalar('select claim_sms_attempt($1,$2,$3,5)',[C,U,S]);
 assert.equal(await scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]),true);
 assert.equal(await scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]),false);
 assert.equal(await scalar('select check_customer_session($1,$2,true)',[U,S]),true);
}));
test('phone enrollment rejects a different account and all equivalent phone formats',()=>tx(async()=>{
 for(const phone of ['2025550102','1 202 555 0102','+1 (202) 555-0102']) {
  assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,phone]),false);
  assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[V,phone]),true);
 }
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,'invalid']),false);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,null]),false);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,'2025550999']),true);
}));
test('legacy phone sharing preserves existing owners but refuses a new account',()=>tx(async()=>{
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',['10000000-0000-4000-8000-000000000003','+12025550102']),true);
 assert.equal(await scalar('select cardinality(user_ids) from private.customer_phone_claims where phone=$1',['+12025550102']),2);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,'+12025550102']),false);
}));
test('database blocks duplicate verification even when the send-time check is bypassed',()=>tx(async()=>{
 await db.exec(`update profiles set phone_verified_at=null where id='${U}'; update customer_sms_challenges set phone='+12025550102',attempt_count=1; savepoint verification;`);
 await assert.rejects(scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]),e=>e.code==='P2001');
 await db.exec('rollback to savepoint verification');
 assert.equal(await scalar('select count(*)::int from customer_sms_sessions'),0);
 assert.equal(await scalar(`select phone_verified_at from profiles where id='${U}'`),null);
 assert.equal(await scalar('select status from customer_sms_challenges'),'pending');
}));
test('an unverified signup cannot reserve a phone; a later verified claim defeats stale availability',()=>tx(async()=>{
 const phone='+12025550999';
 await db.exec(`update profiles set phone_verified_at=null; update profiles set phone='${phone}' where id in ('${U}','${V}')`);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,phone]),true);
 await db.exec(`update profiles set phone_verified_at=now() where id='${V}'`);
 await db.exec(`update customer_sms_challenges set phone='${phone}',attempt_count=1; savepoint verification`);
 await assert.rejects(scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]),e=>e.code==='P2001');
 await db.exec('rollback to savepoint verification');
 assert.equal(await scalar('select count(*)::int from customer_sms_sessions'),0);
}));
test('successful replacement releases old phone only after new verification',()=>tx(async()=>{
 await db.exec(`update profiles set phone_verified_at=null,phone='+12025550999' where id='${U}'`);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[V,'+12025550101']),false);
 await db.exec(`update customer_sms_challenges set phone='+12025550999',attempt_count=1`);
 assert.equal(await scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]),true);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[V,'+12025550101']),true);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[V,'+12025550999']),false);
}));
test('profile deletion releases only that owner; private phone claims are not readable by customers',()=>tx(async()=>{
 await db.exec(`delete from profiles where id='${V}'`);
 assert.equal(await scalar('select can_enroll_customer_phone($1,$2)',[U,'+12025550102']),false);
 assert.equal(await scalar('select cardinality(user_ids) from private.customer_phone_claims where phone=$1',['+12025550102']),1);
 await claims(); await db.exec('set local role authenticated');
 await assert.rejects(db.query('select * from private.customer_phone_claims'),/permission denied/);
}));
test('order IDOR: customer sees only own orders after SMS, none before SMS',()=>tx(async()=>{
 await claims();await db.exec('set local role authenticated');
 assert.equal(await scalar('select count(*)::int from orders'),0);
 await db.exec('reset role');await scalar('select claim_sms_attempt($1,$2,$3,5)',[C,U,S]);await scalar('select complete_sms_challenge($1,$2,$3,24)',[C,U,S]);
 await db.exec('set local role authenticated');
 assert.deepEqual((await db.query('select id from orders')).rows,[{id:1}]);
 assert.equal(await scalar('select count(*)::int from orders where id=2'),0);
 assert.equal(await scalar('select private.is_admin()'),false);
}));
test('only one distinct card request can claim an order; same request can retry',()=>tx(async()=>{
 assert.equal(await scalar('select claim_card_payment(1,$1,$2,100)',[U,'a'.repeat(64)]),true);
 assert.equal(await scalar('select claim_card_payment(1,$1,$2,100)',[U,'a'.repeat(64)]),true);
 assert.equal(await scalar('select claim_card_payment(1,$1,$2,100)',[U,'b'.repeat(64)]),false);
 assert.equal(await scalar('select claim_card_payment(1,$1,$2,100)',[V,'a'.repeat(64)]),false);
 await assert.rejects(db.exec('update orders set total=1 where id=1'),/unresolved/);
}));
test('expired price lock cannot start a payment',()=>tx(async()=>{
 await db.exec("update orders set price_locked_until=now()-interval '1 second' where id=1");
 assert.equal(await scalar('select claim_card_payment(1,$1,$2,100)',[U,'a'.repeat(64)]),false);
}));
test('duplicate webhook does not double-process or downgrade paid orders',()=>tx(async()=>{
 assert.equal(Object.values((await event()).rows[0])[0],true);
 assert.equal(Object.values((await event()).rows[0])[0],false);
 await event('evt_old','failed');
 assert.equal(await scalar('select payment_status from orders where id=1'),'paid');
 assert.equal(await scalar('select count(*)::int from payment_events'),2);
}));
test('failed reconciliation rolls back event so provider can retry',()=>tx(async()=>{
 await db.exec('savepoint before_event');
 await assert.rejects(event('evt_retry','paid','pi_wrong'),/reference mismatch/);
 await db.exec('rollback to savepoint before_event');
 assert.equal(await scalar('select count(*)::int from payment_events'),0);
 await event('evt_retry');assert.equal(await scalar('select count(*)::int from payment_events'),1);
}));
test('cancelled order stays cancelled even when late payment is real',()=>tx(async()=>{
 await db.exec("update orders set status='cancelled' where id=1");await event();
 assert.equal(await scalar('select status from orders where id=1'),'cancelled');
 assert.equal(await scalar('select payment_status from orders where id=1'),'paid');
}));
test('unpaid or unreviewed orders cannot enter fulfillment',()=>tx(async()=>{
 await db.exec('savepoint fulfillment');
 await assert.rejects(db.exec("update orders set status='processing' where id=1"),/Payment is required/);
 await db.exec('rollback to savepoint fulfillment');await event();
 await db.exec("insert into order_risk_reviews(order_id,decision) values(1,'pending'); savepoint review");
 await assert.rejects(db.exec("update orders set status='processing' where id=1"),/risk review/);
 await db.exec("rollback to savepoint review;update order_risk_reviews set decision='approved'; update orders set status='processing' where id=1");
 assert.equal(await scalar('select status from orders where id=1'),'processing');
}));

test('new orders receive risk assessment using custom verified phone',()=>tx(async()=>{
 await db.exec(`insert into orders(id,user_id,total,status,payment_method,payment_status) values(3,'${U}',100,'pending_review','wire','unpaid')`);
 const row=(await db.query('select * from order_risk_reviews where order_id=3')).rows[0];
 assert.ok(row); assert.equal(row.signals.some(s=>s.code==='phone_mfa_missing'),false); assert.equal(row.decision,'approved');
}));
test('risk thresholds come from private configuration',()=>tx(async()=>{
 await db.exec("update app_settings set value='50' where key='risk_very_high_value'");
 await db.exec(`insert into orders(id,user_id,total,status,payment_method,payment_status) values(3,'${U}',100,'pending_review','wire','unpaid')`);
 assert.equal(await scalar('select decision from order_risk_reviews where order_id=3'),'pending');
}));
test('admin cannot manually fake a card settlement',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}')`);
 await assert.rejects(db.query(`select admin_update_order($1,1,'payment_received','paid','','','testing')`,[U]),/payment provider/);
}));
test('wire paid action is permitted only for admin and is audited',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}');update orders set payment_method='wire' where id=1`);
 await db.query(`select admin_update_order($1,1,'payment_received','paid','','','verified receipt')`,[U]);
 assert.equal(await scalar("select count(*)::int from admin_audit_log where action='wire.manually_marked_paid'"),1);
 assert.equal(await scalar('select payment_status from orders where id=1'),'paid');
}));

test('stale server order snapshot cannot start payment at a previous total',()=>tx(async()=>{
 await db.exec('update orders set total=101 where id=1');
 assert.equal(await scalar('select claim_card_payment(1,$1,$2,100)',[U,'a'.repeat(64)]),false);
}));

// Admin order edits must preserve payment state and remain transactional.
test('tracking-only edits preserve current status, payment and private notes',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}');update orders set payment_status='paid',status='payment_received',internal_notes='existing note' where id=1`);
 await db.query(`select admin_update_order($1,1,null,null,'TRACK-123',null,'add tracking')`,[U]);
 const row=(await db.query('select status,payment_status,internal_notes,tracking_number from orders where id=1')).rows[0];
 assert.deepEqual(row,{status:'payment_received',payment_status:'paid',internal_notes:'existing note',tracking_number:'TRACK-123'});
}));
test('pending and awaiting orders can cancel and restock exactly once',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}');insert into products values(10,5);insert into order_items values(1,10,2),(2,10,1);update orders set status='pending_review' where id=2`);
 for(const id of [1,2]) {
  await db.query(`select admin_update_order($1,$2,'cancelled',null,null,null,'customer cancelled')`,[U,id]);
  await db.query(`select admin_update_order($1,$2,null,null,'TRACK',null,'record reference')`,[U,id]);
 }
 assert.equal(await scalar('select inventory_count from products where id=10'),8);
 assert.equal(await scalar("select count(*)::int from orders where status='cancelled'"),2);
}));
test('paid approved pre-fulfillment orders can be shipped in one audited action',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}');update orders set payment_status='paid' where id=1;insert into order_risk_reviews(order_id,decision) values(1,'approved')`);
 await db.query(`select admin_update_order($1,1,'shipped',null,'TRACK-123',null,'parcel handed to carrier')`,[U]);
 assert.equal(await scalar('select status from orders where id=1'),'shipped');
 assert.equal(await scalar('select tracking_number from orders where id=1'),'TRACK-123');
 assert.equal(await scalar("select metadata->>'previous_status' from admin_audit_log"),'awaiting_payment');
}));
test('shipment shortcut cannot bypass payment or risk review',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}')`);
 await db.exec('savepoint unpaid');
 await assert.rejects(db.query(`select admin_update_order($1,1,'shipped',null,'TRACK',null,'attempt shipment')`,[U]),/Payment is required/);
 await db.exec('rollback to savepoint unpaid');
 await db.exec(`update orders set payment_status='paid' where id=1;insert into order_risk_reviews(order_id,decision) values(1,'pending');savepoint review`);
 await assert.rejects(db.query(`select admin_update_order($1,1,'shipped',null,'TRACK',null,'attempt shipment')`,[U]),/risk review/);
 await db.exec('rollback to savepoint review');
 assert.equal(await scalar('select status from orders where id=1'),'awaiting_payment');
 assert.equal(await scalar('select tracking_number from orders where id=1'),null);
}));
test('shipped order cannot move backwards or restock through cancellation',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}');update orders set payment_status='paid' where id=1`);
 await db.query(`select admin_update_order($1,1,'shipped',null,null,null,'shipped parcel')`,[U]);
 for(const state of ['awaiting_payment','cancelled']) {
  await db.exec('savepoint blocked');
  await assert.rejects(db.query(`select admin_update_order($1,1,$2,null,null,null,'invalid change')`,[U,state]),/backwards|return process/);
  await db.exec('rollback to savepoint blocked');
 }
}));
test('tracking edit on paid wire does not repeat the payment-received audit',()=>tx(async()=>{
 await db.exec(`insert into admin_users values('${U}');update orders set payment_method='wire' where id=1`);
 await db.query(`select admin_update_order($1,1,'payment_received','paid',null,null,'verified wire')`,[U]);
 await db.query(`select admin_update_order($1,1,null,null,'TRACK',null,'add tracking')`,[U]);
 assert.equal(await scalar("select count(*)::int from admin_audit_log where action='wire.manually_marked_paid'"),1);
}));
