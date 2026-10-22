import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
process.env.SUPABASE_SECRET_KEY='fixture-server-only';
const {default:handler}=await import('../api/admin/order-emails.js');
const userId='10000000-0000-4000-8000-000000000001';
const sessionId='20000000-0000-4000-8000-000000000001';
function request(method,body={},aal='aal2'){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method,headers:{authorization:'Bearer '+[{}, {sub:userId,aal,session_id:sessionId},'sig'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')}})}
function response(){return {statusCode:200,body:null,status(code){this.statusCode=code;return this},setHeader(){return this},end(body){this.body=JSON.parse(body)}}}
function install({admin=true,settings=null}={}){const original=global.fetch,requests=[];global.fetch=async(url,options={})=>{const path=new URL(url).pathname;requests.push({path,options});let data;
 if(path.endsWith('/auth/v1/user'))data={id:userId,email:'admin@example.test',email_confirmed_at:'2026-01-01'};
 else if(path.endsWith('/rpc/check_customer_session'))data=true;
 else if(path.endsWith('/admin_users'))data=admin?{user_id:userId}:null;
 else if(path.endsWith('/rpc/consume_security_rate_limit'))data=0;
 else if(path.endsWith('/rpc/get_order_email_secret'))data=settings;
 else if(path.endsWith('/order_email_outbox'))data=[];
 else if(path==='/emails')data={id:'fixture-provider-id'};
 else if(path.endsWith('/rpc/configure_order_email')||path.endsWith('/admin_audit_log'))data=null;
 else throw new Error('Unexpected fixture request '+path);
 return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})};return {requests,restore(){global.fetch=original}}}
test('email admin rejects missing authentication, non-admins and AAL1 before secret access',async()=>{for(const mode of ['missing','nonadmin','aal1']){const f=install({admin:mode!=='nonadmin'});try{const req=request('GET',{},mode==='aal1'?'aal1':'aal2');if(mode==='missing')req.headers={};const res=response();await handler(req,res);assert.ok([401,403].includes(res.statusCode));assert.equal(f.requests.some(r=>r.path.endsWith('/rpc/get_order_email_secret')),false)}finally{f.restore()}}});
test('admin GET never returns the stored API key',async()=>{const f=install({settings:{api_key:'re_private_do_not_return',enabled:true,from_email:'orders@goldonthespot.com'}});try{const res=response();await handler(request('GET'),res);assert.equal(res.statusCode,200);assert.equal(res.body.configured,true);assert.equal(JSON.stringify(res.body).includes('re_private_do_not_return'),false)}finally{f.restore()}});
test('connect rejects arbitrary recipients and sends sample only to verified admin',async()=>{const f=install();try{const body={action:'connect',api_key:'re_fixture_api_key',from_email:'orders@goldonthespot.com',reply_to:'support@goldonthespot.com',reason:'Enable branded emails'};let res=response();await handler(request('POST',{...body,to:'attacker@example.test'}),res);assert.equal(res.statusCode,400);assert.equal(f.requests.some(r=>r.path==='/emails'),false);res=response();await handler(request('POST',body),res);assert.equal(res.statusCode,200);const sends=f.requests.filter(r=>r.path==='/emails');assert.equal(sends.length,1);assert.deepEqual(JSON.parse(sends[0].options.body).to,['admin@example.test']);assert.ok(f.requests.some(r=>r.path.endsWith('/rpc/configure_order_email')))}finally{f.restore()}});
