import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const U='10000000-0000-4000-8000-000000000001',A='10000000-0000-4000-8000-000000000002',O='10000000-0000-4000-8000-000000000003',C='20000000-0000-4000-8000-000000000001',R='30000000-0000-4000-8000-000000000001';
let db;
before(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${U}'),('${A}'),('${O}');create table admin_users(user_id uuid primary key);insert into admin_users values('${A}');create table admin_audit_log(actor_user_id uuid,action text,target_type text,target_id text,metadata jsonb);create table sell_requests(id uuid primary key,user_id uuid,updated_at timestamptz,version integer default 1);insert into sell_requests(id,user_id) values('${C}','${U}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);grant select on admin_users to service_role;grant select,update on sell_requests to service_role;grant insert on admin_audit_log to service_role;`);const dir=new URL('../supabase/migrations/',import.meta.url),file=(await readdir(dir)).find(x=>x.endsWith('_selling_case_conversations.sql'));await db.exec(await readFile(new URL(file,dir),'utf8'));});
after(()=>db?.close());
test('case messages and RPC deny direct anonymous/customer access; bucket private',async()=>{for(const role of ['anon','authenticated']){const {rows}=await db.query("select has_table_privilege($1,'sell_case_messages','select') r,has_table_privilege($1,'sell_case_messages','insert') w,has_function_privilege($1,'append_sell_case_message(uuid,uuid,uuid,text,text,text)','execute') f",[role]);assert.deepEqual(rows[0],{r:false,w:false,f:false});}assert.equal((await db.query("select public from storage.buckets")).rows[0].public,false);});
test('database enforces ownership, deduplication, changed replay and private admin audit',async()=>{
 const send=(actor,request,message)=>db.query('select append_sell_case_message($1,$2,$3,$4) m',[actor,C,request,message]);
 await assert.rejects(send(O,R,'intruder'),/Case not found/);
 const first=(await send(U,R,'Photo follows')).rows[0].m;assert.deepEqual((await send(U,R,'Photo follows')).rows[0].m,first);
 await assert.rejects(send(U,R,'Changed replay'),/already used/);
 const reply=(await send(A,R,'Private evaluation details')).rows[0].m;assert.equal(reply.sender_role,'admin');
 const audits=(await db.query('select * from admin_audit_log')).rows;assert.equal(audits.length,1);assert.ok(!JSON.stringify(audits).includes('evaluation details'));
});
test('six-photo limit is enforced atomically in database',async()=>{for(let i=0;i<6;i++)await db.query('select append_sell_case_message($1,$2,$3,$4,$5,$6)',[U,C,crypto.randomUUID(),'','case/'+i+'.jpg','a'.repeat(64)]);await assert.rejects(db.query('select append_sell_case_message($1,$2,$3,$4,$5,$6)',[U,C,crypto.randomUUID(),'','case/7.jpg','a'.repeat(64)]),/six photos/);});
const source=await readFile(new URL('../supabase/functions/sell-case-thread/index.ts',import.meta.url),'utf8');
const shared=await readFile(new URL('../supabase/functions/_shared/security.ts',import.meta.url),'utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(shared.replace(/^import type .*;\n/m,''))).toString('base64'));
const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace('export function decodeCasePhoto','function decodeCasePhoto'));
function harness({admin=false,aal='aal1',session=true,owner=true,limited=false}={}){let handler;const calls=[];
 const client={auth:{getUser:async()=>({data:{user:{id:U}}})},from(table){const chain={select:()=>chain,eq:(key,value)=>{calls.push({table,key,value});return chain},maybeSingle:async()=>({data:table==='admin_users'?(admin?{user_id:U}:null):table==='sell_requests'?(owner?{id:C}:null):null}),order:()=>chain,range:async()=>({data:[]})};return chain},rpc:async(name,args)=>{calls.push({name,args});return {data:name==='check_customer_session'?session:name==='consume_security_rate_limit'?(limited?60:0):{id:R,body:args.p_body,sender_role:admin?'admin':'customer',created_at:new Date().toISOString()}}}};
 new Function('createClient',...Object.keys(helpers),'Deno',code)(()=>client,...Object.values(helpers),{env:{get:key=>key==='SUPABASE_SECRET_KEYS'?undefined:'fixture'},serve:fn=>handler=fn});
 // SUPABASE_SECRET_KEYS is intentionally absent, not a fake JSON secret.
 const token=[{},{aal,session_id:R},'sig'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 return {calls,request:(body,auth=true)=>handler(new Request('https://fixture.test/thread',{method:'POST',headers:{origin:'https://goldonthespot.com',...(auth?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}))};}
const read={action:'read',case_id:C,offset:0},send={action:'send',case_id:C,request_id:R,message:'I have 18 grams of broken gold jewelry.',photo:null};
test('thread rejects unauthenticated, other-owner, SMS-unverified and non-MFA-admin requests',async()=>{
 assert.equal((await harness().request(read,false)).status,401);
 for(const [options,status] of [[{owner:false},404],[{session:false},403],[{admin:true},403]])assert.equal((await harness(options).request(read)).status,status);
});
test('thread applies owner filter, trusted actor and persistent limits',async()=>{const h=harness();assert.equal((await h.request(read)).status,200);assert.ok(h.calls.some(x=>x.table==='sell_requests'&&x.key==='user_id'&&x.value===U));assert.equal((await h.request(send)).status,200);assert.equal(h.calls.find(x=>x.name==='append_sell_case_message').args.p_actor,U);assert.equal((await harness({limited:true}).request(send)).status,429);});
test('thread rejects actor injection, control characters, unsupported photos and oversize input',async()=>{for(const patch of [{user_id:O},{message:'bad\u0000'},{message:'x'.repeat(2001)},{photo:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}]){const h=harness();assert.equal((await h.request({...send,...patch})).status,400);assert.ok(!h.calls.some(x=>x.name==='append_sell_case_message'));}});
