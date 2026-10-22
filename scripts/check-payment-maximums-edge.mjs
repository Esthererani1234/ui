import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../supabase/functions/admin-operations/index.ts',import.meta.url),'utf8');
const shared=await readFile(new URL('../supabase/functions/_shared/security.ts',import.meta.url),'utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(shared.replace(/^import type .*;\n/m,''))).toString('base64'));
const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''));const user='10000000-0000-4000-8000-000000000001';
function harness({admin=false,aal='aal1',valid=true,error=null}={}){let handler;const calls=[];const client={auth:{getUser:async()=>({data:{user:{id:user}}})},from(){const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:admin?{user_id:user}:null})};return chain},rpc:async(name,args)=>{calls.push({name,args});if(name==='check_customer_session')return {data:valid};if(name==='consume_security_rate_limit')return {data:0};if(name==='admin_set_payment_maximums')return {data:error?null:{success:true,limits:args.p_limits},error};throw new Error(name)}};new Function('createClient',...Object.keys(helpers),'Deno',code)(()=>client,...Object.values(helpers),{env:{get:key=>({SUPABASE_URL:'https://fixture.test',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'})[key]},serve:fn=>handler=fn});const token=[{}, {aal,session_id:'20000000-0000-4000-8000-000000000001'},'sig'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return {calls,request:body=>handler(new Request('https://fixture.test/support',{method:'POST',headers:{origin:'https://goldonthespot.com',authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}))}}

const limits={card_order_maximum:7500,wire_order_maximum:85000,crypto_order_maximum:1500000};
const payload={action:'update_payment_maximums',limits,reason:'Update payment limits'};
test('maximum edits require an admin, AAL2 and a valid live session',async()=>{
 for(const options of [{admin:false,aal:'aal2'},{admin:true,aal:'aal1'},{admin:true,aal:'aal2',valid:false}]){
  const h=harness(options),r=await h.request(payload);assert.equal(r.status,options.valid===false?401:403);assert.equal(h.calls.some(c=>c.name==='admin_set_payment_maximums'),false);
 }
});
test('maximum edits bind the verified admin and use the audited atomic RPC',async()=>{
 const h=harness({admin:true,aal:'aal2'}),r=await h.request(payload);assert.equal(r.status,200);
 const c=h.calls.find(c=>c.name==='admin_set_payment_maximums');assert.deepEqual(c.args,{p_actor:user,p_limits:limits,p_reason:payload.reason});
 assert.deepEqual((await r.json()).limits,limits);
});
test('maximum edits reject spoofed actor and surface safe validation errors',async()=>{
 const h=harness({admin:true,aal:'aal2'});assert.equal((await h.request({...payload,p_actor:'other'})).status,400);
 assert.equal(h.calls.some(c=>c.name==='admin_set_payment_maximums'),false);
 const bad=harness({admin:true,aal:'aal2',error:{code:'22023',message:'Payment maximums must be dollar amounts.'}});
 const r=await bad.request(payload);assert.equal(r.status,400);assert.match((await r.json()).error,/dollar amounts/);
});
