import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const U='10000000-0000-4000-8000-000000000001',R='20000000-0000-4000-8000-000000000001';
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values(\'${U}\'),(\'${R}\');
 create table admin_users(user_id uuid primary key);insert into admin_users values('${U}');
 create table admin_audit_log(actor_user_id uuid,action text,target_type text,target_id text,reason text,metadata jsonb);
 grant select on admin_users to service_role;grant insert on admin_audit_log to service_role;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),file=(await readdir(dir)).find(name=>name.endsWith('_sell_requests_portal.sql'));
 await db.exec(await readFile(new URL(file,dir),'utf8'));
 const accounts=(await readdir(dir)).find(name=>name.endsWith('_selling_centre_accounts.sql'));await db.exec(await readFile(new URL(accounts,dir),'utf8'));
});
after(()=>db?.close());
test('sell database denies anonymous/customer reads and writes and privileged RPCs',async()=>{
 for(const role of ['anon','authenticated']){
  const {rows}=await db.query(`select has_table_privilege($1,'sell_requests','select') as r,has_table_privilege($1,'sell_requests','insert') as w,has_function_privilege($1,'submit_sell_request(uuid,uuid,text,text,text,text)','execute') as f,has_function_privilege($1,'update_sell_request(uuid,uuid,integer,text,text)','execute') as a`,[role]);
  assert.deepEqual(rows[0],{r:false,w:false,f:false,a:false});
 }
 assert.equal((await db.query("select relrowsecurity from pg_class where relname='sell_requests'")).rows[0].relrowsecurity,true);
});
test('sell requests are deduplicated, disclose only a receipt, and reject changed replay',async()=>{
 const sql=`select submit_sell_request(\'${U}\', $1,'Test Seller','seller@example.test','+12025550123',$2) as receipt`;
 const a=(await db.query(sql,[R,'Two broken gold chains.'])).rows[0].receipt;
 const b=(await db.query(sql,[R,'Two broken gold chains.'])).rows[0].receipt;
 assert.deepEqual(a,b);assert.deepEqual(Object.keys(a).sort(),['received_at','reference']);
 await assert.rejects(db.query(sql,[R,'Different items for evaluation.']),/already used/);
 assert.equal((await db.query('select count(*)::int n from sell_requests')).rows[0].n,1);
});
test('admin updates audit atomically, reject stale saves, and do not duplicate retries',async()=>{
 const id=(await db.query('select id from sell_requests')).rows[0].id;
 const query=(actor,version,status,notes)=>db.query('select update_sell_request($1,$2,$3,$4,$5)',[actor,id,version,status,notes]);
 await assert.rejects(query(R,1,'reviewing','private note'),/Administrator/);
 await query(U,1,'reviewing','private note');await query(U,1,'reviewing','private note');
 await assert.rejects(query(U,1,'quoted','new note'),/changed/);
 await assert.rejects(query(U,2,'paid','bad status'),/check constraint/);
 const audit=(await db.query('select * from admin_audit_log')).rows;
 assert.equal(audit.length,1);assert.deepEqual(audit[0].metadata,{status:'reviewing',version:2});assert.ok(!JSON.stringify(audit).includes('private note'));
});

const source=await readFile(new URL('../supabase/functions/sell-requests/index.ts',import.meta.url),'utf8');
const shared=await readFile(new URL('../supabase/functions/_shared/security.ts',import.meta.url),'utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(shared.replace(/^import type .*;\n/m,''))).toString('base64'));
const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''));
function harness({admin=false,aal='aal1',valid=true,limited=false,authValid=true}={}){
 let handler;const calls=[];
 const client={auth:{getUser:async()=>({data:{user:authValid?{id:U,email:'seller@example.test',email_confirmed_at:'2026-10-22'}:null},error:!authValid})},from(table){const chain={select:(columns)=>{calls.push({columns});return chain},eq:(column,value)=>{calls.push({column,value});return chain},maybeSingle:async()=>({data:admin?{user_id:U}:null}),order:()=>chain,range:async()=>({data:[]})};calls.push({table});return chain;},rpc:async(name,args)=>{calls.push({name,args});if(name==='check_customer_session')return {data:valid};if(name==='consume_security_rate_limit')return {data:limited?60:0};return {data:{reference:'SELL-FIXTURE'}};}};
 new Function('createClient',...Object.keys(helpers),'Deno',code)(()=>client,...Object.values(helpers),{env:{get:k=>({SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'})[k]},serve:fn=>handler=fn});
 const token=[{alg:'HS256'},{aal,session_id:R},'sig'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 return {calls,request:(body,{auth=true,origin='https://goldonthespot.com'}={})=>handler(new Request('https://fixture.test/sell',{method:'POST',headers:{origin,...(auth?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}))};
}
const form={action:'create',request_id:R,name:'Test Seller',email:'seller@example.test',phone:'+1 (202) 555-0123',message:'Two broken gold chains.',website:''};
test('signed-in case uses four persistent rate limits and trusted account identity',async()=>{
 const h=harness(),r=await h.request(form);assert.equal(r.status,200);
 assert.equal(h.calls.filter(c=>c.name==='consume_security_rate_limit').length,4);
 assert.equal(h.calls.find(c=>c.name==='submit_sell_request').args.p_email,form.email);
 assert.ok(h.calls.filter(c=>c.name==='consume_security_rate_limit').every(c=>c.args.p_subject!==form.email));
});
test('signed-in case rejects unexpected fields, bad email/phone, bots, oversize and short message',async()=>{
 for(const changes of [{status:'quoted'},{email:'bad'},{phone:'javascript:alert(1)'},{website:'bot'},{message:'x'},{name:'x'.repeat(121)},{request_id:'guess'}]){
  const h=harness(),r=await h.request({...form,...changes});assert.equal(r.status,400);assert.equal(h.calls.some(c=>c.name==='submit_sell_request'),false);
 }
 const h=harness();assert.equal((await h.request({...form,message:'x'.repeat(25000)})).status,413);
});
test('rate-limited quote never writes, invalid origin is denied',async()=>{
 const h=harness({limited:true});assert.equal((await h.request(form)).status,429);assert.equal(h.calls.some(c=>c.name==='submit_sell_request'),false);
 assert.equal((await harness().request(form,{origin:'https://attacker.test'})).status,403);
});
test('sell admin list/update require verified admin, MFA and live session',async()=>{
 for(const options of [{},{admin:true,aal:'aal1'},{admin:true,aal:'aal2',valid:false},{admin:true,aal:'aal2',authValid:false}]){
  const h=harness(options);for(const action of ['list','update']){const r=await h.request({action,offset:0},{auth:true});assert.ok([401,403].includes(r.status));}
  assert.equal(h.calls.some(c=>c.table==='sell_requests'||c.name==='update_sell_request'),false);
 }
 assert.equal((await harness().request({action:'list',offset:0},{auth:false})).status,401);
 const h=harness({admin:true,aal:'aal2'});assert.equal((await h.request({action:'list',offset:0},{auth:true})).status,200);
 assert.equal((await h.request({action:'update',id:R,version:1,status:'reviewing',internal_notes:'Internal only'},{auth:true})).status,200);
 assert.equal(h.calls.find(c=>c.name==='update_sell_request').args.p_actor,U);
});

test('selling cases require login and SMS; owner filters and private field exclusion are enforced',async()=>{
 for(const action of ['create','mine']){const body=action==='create'?form:{action,offset:0};assert.equal((await harness().request(body,{auth:false})).status,401);assert.equal((await harness({valid:false}).request(body)).status,403);}
 const h=harness();assert.equal((await h.request({action:'mine',offset:0})).status,200);
 assert.ok(h.calls.some(c=>c.column==='user_id'&&c.value===U));
 assert.ok(h.calls.find(c=>c.name==='check_customer_session').args.p_require_sms);
 assert.ok(h.calls.filter(c=>c.columns).every(c=>!c.columns.includes('internal_notes')));
 assert.equal((await h.request({action:'mine',offset:0,user_id:R})).status,400);
 assert.equal((await h.request({...form,user_id:R})).status,400);
 await h.request(form);assert.equal(h.calls.find(c=>c.name==='submit_sell_request').args.p_user_id,U);
});
test('account-owned receipt cannot be replayed by another owner; legacy guest RPC retired',async()=>{
 await assert.rejects(db.query("select submit_sell_request($1,$2,'Test Seller','seller@example.test','+12025550123','Two broken gold chains.')",[R,R]),/already used/);
 assert.equal((await db.query("select has_function_privilege('service_role','submit_sell_request(uuid,text,text,text,text)','execute') as allowed")).rows[0].allowed,false);
 assert.equal((await db.query('select user_id from sell_requests where request_id=$1',[R])).rows[0].user_id,U);
});
