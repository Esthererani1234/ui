import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {renderAccountEmail} from '../supabase/functions/_shared/accountEmail.js';
let db;const user='10000000-0000-4000-8000-000000000001',session='20000000-0000-4000-8000-000000000001';
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
 create table public.customer_sms_sessions(session_id uuid primary key,user_id uuid,purpose text,verified_at timestamptz default now(),expires_at timestamptz default now()+interval '1 day');
 create table app_settings(key text primary key,value jsonb);insert into app_settings values('order_emails_enabled','true');
 create table order_email_outbox(id uuid default gen_random_uuid(),order_id bigint,ticket_id bigint,event_key text,event_type text,recipient text,order_snapshot jsonb,available_at timestamptz,
 constraint email_one_resource check((order_id is not null)::int+(ticket_id is not null)::int=1),constraint order_email_outbox_event_type_check check(event_type in ('placed')));
 alter table order_email_outbox enable row level security;
 insert into auth.users values('${user}','old@example.test',now(),'PRIVATE_HASH_A');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261023141252_account_security_emails.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
async function tx(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
const rows=async()=> (await db.query('select * from order_email_outbox')).rows;
test('verified sign-in queues exactly once per session including repeated verification',()=>tx(async()=>{
 await db.exec(`insert into customer_sms_sessions(session_id,user_id,purpose) values('${session}','${user}','signin');update customer_sms_sessions set verified_at=now();`);
 const jobs=await rows();assert.equal(jobs.length,1);assert.equal(jobs[0].event_type,'account_signin');assert.equal(jobs[0].recipient,'old@example.test');
 assert.deepEqual(Object.keys(jobs[0].order_snapshot),['occurred_at']);
}));
test('recovery OTP and unverified emails do not generate successful-signin notifications',()=>tx(async()=>{
 await db.exec(`insert into customer_sms_sessions(session_id,user_id,purpose) values('${session}','${user}','recovery');`);
 assert.equal((await rows()).length,0);
 await db.exec(`update auth.users set email_confirmed_at=null;update customer_sms_sessions set purpose='signin';`);
 assert.equal((await rows()).length,0);
}));
test('password changes notify verified owner without storing passwords or hashes',()=>tx(async()=>{
 await db.exec("update auth.users set encrypted_password='PRIVATE_HASH_B';update auth.users set encrypted_password='PRIVATE_HASH_B';");
 const jobs=await rows();assert.equal(jobs.length,1);assert.equal(jobs[0].event_type,'account_password_changed');assert.ok(!JSON.stringify(jobs).includes('PRIVATE_HASH'));
}));
test('email changes notify previous verified address and verified new address',()=>tx(async()=>{
 await db.exec("update auth.users set email='new@example.test';");const jobs=await rows();assert.deepEqual(jobs.map(j=>j.recipient).sort(),['new@example.test','old@example.test']);
 assert.ok(jobs.every(j=>j.event_type==='account_email_changed'));
}));
test('unverified new email is not a notification recipient',()=>tx(async()=>{
 await db.exec("update auth.users set email='unverified@example.test',email_confirmed_at=null;");assert.deepEqual((await rows()).map(j=>j.recipient),['old@example.test']);
}));
test('customers cannot read notification records or call the privileged trigger',()=>tx(async()=>{
 for(const role of ['anon','authenticated']){
  const result=(await db.query(`select has_table_privilege('${role}','public.order_email_outbox','SELECT') as readable,has_function_privilege('${role}','private.queue_account_security_email()','EXECUTE') as callable`)).rows[0];
  assert.equal(result.readable,false);assert.equal(result.callable,false);
 }
}));
test('disabled notifications preserve successful account updates',()=>tx(async()=>{
 await db.exec("update app_settings set value='false';update auth.users set encrypted_password='PRIVATE_HASH_C';");assert.equal((await rows()).length,0);
}));
test('security templates have real timestamps and safe links without credentials',()=>{
 for(const event of ['account_signin','account_password_changed','account_email_changed']){
  const email=renderAccountEmail({event,details:{occurred_at:'2026-10-23T14:00:00Z'}});
  assert.match(email.text,/10:00 AM/);assert.match(email.html,/https:\/\/goldonthespot.com\/account\?tab=security/);assert.match(email.text,/If you did not/);
 }
 assert.throws(()=>renderAccountEmail({event:'unknown',details:{}}));
});
