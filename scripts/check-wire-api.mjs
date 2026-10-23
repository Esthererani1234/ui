import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {validWireAgreement,WIRE_AGREEMENT_VERSION} from '../supabase/functions/_shared/wireAgreement.js';
const source=await readFile(new URL('../supabase/functions/create-order/index.ts',import.meta.url),'utf8');
const shared=await readFile(new URL('../supabase/functions/_shared/security.ts',import.meta.url),'utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(shared.replace(/^import type .*;\n/m,''))).toString('base64'));
const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''));const U='10000000-0000-4000-8000-000000000001';
function harness({valid=true,sms=true,error=null}={}){
 let handler;const calls=[];
 const client={auth:{getUser:async()=>({data:{user:{id:U,email:'verified@example.test'}}})},from(table){const chain={select:()=>chain,eq:()=>chain,gt:()=>chain,in:async()=>({data:[{key:'customer_sms_mfa_required',value:true}]}),maybeSingle:async()=>({data:table==='customer_sms_sessions'?(sms?{session_id:'test'}:null):null})};return chain;},rpc:async(name,args)=>{calls.push({name,args});if(name==='check_customer_session')return {data:valid};if(name==='check_checkout_rate_limit')return {data:true};if(name==='place_checkout_order')return {data:error?null:{order_id:1,order_number:'TEST',total:135},error};throw new Error(name)}};
 new Function('createClient','validWireAgreement',...Object.keys(helpers),'Deno',code)(()=>client,validWireAgreement,...Object.values(helpers),{env:{get:key=>({SUPABASE_URL:'https://fixture.test',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'})[key]},serve:fn=>handler=fn});
 const token=[{},{sub:U,session_id:'20000000-0000-4000-8000-000000000001'},'sig'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 return {calls,request:body=>handler(new Request('https://fixture.test/create-order',{method:'POST',headers:{origin:'https://goldonthespot.com',authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}))};
}
const payload={quote_id:'30000000-0000-4000-8000-000000000001',contact:{first_name:'Test',last_name:'Only',phone:'+12025550123',email:'attacker@example.test'},shipping:{address_line_1:'1 Test Street',address_line_2:'',city:'New York',state:'NY',postal_code:'10001',country:'US'},payment_method:'wire',terms:{accepted:true,version:'2026-10-22'},wire_agreement:{accepted:true,version:WIRE_AGREEMENT_VERSION}};
test('revised terms reach the atomic order RPC unchanged',async()=>{const h=harness();assert.equal((await h.request({...payload,terms:{accepted:true,version:'2026-10-22-v2'}})).status,201);assert.equal(h.calls.find(c=>c.name==='place_checkout_order').args.p_terms.version,'2026-10-22-v2');});
test('checkout binds authenticated user/email and commits consent through single atomic RPC',async()=>{const h=harness(),r=await h.request(payload);assert.equal(r.status,201);const c=h.calls.find(c=>c.name==='place_checkout_order');assert.equal(c.args.p_user_id,U);assert.equal(c.args.p_contact.email,'verified@example.test');assert.deepEqual(c.args.p_wire_agreement,payload.wire_agreement);});
test('wire consent, current terms and strict schemas reject bypasses before order RPC',async()=>{
 for(const change of [{wire_agreement:null},{wire_agreement:{...payload.wire_agreement,accepted:false}},{wire_agreement:{...payload.wire_agreement,version:'old'}},{terms:{accepted:true,version:'old'}},{total:1},{shipping:{...payload.shipping,paid:true}},{shipping:{...payload.shipping,country:'CA'}},{contact:[]},{quote_id:null}]){const h=harness();assert.equal((await h.request({...payload,...change})).status,400);assert.equal(h.calls.some(c=>c.name==='place_checkout_order'),false);}
});
test('missing SMS or revoked session cannot create a wire order',async()=>{for(const opts of [{sms:false},{valid:false}]){const h=harness(opts);assert.ok([401,403].includes((await h.request(payload)).status));assert.equal(h.calls.some(c=>c.name==='place_checkout_order'),false);}});
test('checkout hides database internals but exposes controlled agreement validation',async()=>{let r=await harness({error:{code:'42P01',message:'private.secret missing'}}).request(payload);assert.ok(!(await r.text()).includes('private.secret'));r=await harness({error:{code:'P2006',message:'Accept the bank-wire purchase agreement before continuing.'}}).request(payload);assert.match(await r.text(),/agreement/);});
