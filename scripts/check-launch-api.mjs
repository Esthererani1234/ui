import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
process.env.SUPABASE_SECRET_KEY='fixture-server-only';
const {default:complete}=await import('../server/payments/complete-card.js');
const {default:health}=await import('../api/admin/launch-health.js');
const {default:reconcile}=await import('../api/operations/reconcile-payments.js');
const {default:paymentRoute,config:routeConfig}=await import('../api/payments/[action].js');
const uid='10000000-0000-4000-8000-000000000001';
function request(method,body={},aal='aal2'){
 const token=[{}, {sub:uid,aal,session_id:'20000000-0000-4000-8000-000000000001'},'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method,headers:{authorization:'Bearer '+token}});
}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this},setHeader(){return this},end(body){this.body=JSON.parse(body)}};}
function fixture({admin=true,sms=true}={}){
 const original=global.fetch,calls=[];
 global.fetch=async(url,options={})=>{
  const u=new URL(url);calls.push({u,options});let data;
  if(u.pathname.endsWith('/auth/v1/user'))data={id:uid,email_confirmed_at:'2026-01-01'};
  else if(u.pathname.endsWith('/rpc/check_customer_session'))data=JSON.parse(options.body).p_require_sms?sms:true;
  else if(u.pathname.endsWith('/admin_users'))data=admin?{user_id:uid}:null;
  else if(u.pathname.endsWith('/rpc/consume_security_rate_limit'))data=0;
  else if(u.pathname.endsWith('/orders'))data=null;
  else if(u.pathname.endsWith('/rpc/check_payment_reconciliation_token'))data=false;
  else throw new Error('Unexpected request: '+u.pathname);
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 };
 return {calls,restore(){global.fetch=original}};
}
test('card completion rejects missing auth and unverified SMS before reading orders',async()=>{
 for(const missing of [true,false]){const f=fixture({sms:false});try{const req=request('POST',{order_id:91});if(missing)req.headers={};const res=response();await complete(req,res);assert.equal(res.statusCode,missing?401:403);assert.ok(!f.calls.some(x=>x.u.pathname.endsWith('/orders')));}finally{f.restore()}}
});
test('card completion scopes order lookup to authenticated owner and rejects client amounts',async()=>{
 const f=fixture();try{
  let res=response();await complete(request('POST',{order_id:91,amount:1}),res);assert.equal(res.statusCode,400);
  res=response();await complete(request('POST',{order_id:91}),res);assert.equal(res.statusCode,404);
  const lookup=f.calls.find(x=>x.u.pathname.endsWith('/orders'));assert.equal(lookup.u.searchParams.get('user_id'),'eq.'+uid);assert.equal(lookup.u.searchParams.get('id'),'eq.91');
 }finally{f.restore()}
});
test('operations health rejects normal users and AAL1 admins before private diagnostics',async()=>{
 for(const admin of [true,false]){const f=fixture({admin});try{const res=response();await health(request('GET',{},admin?'aal1':'aal2'),res);assert.equal(res.statusCode,403);assert.ok(!f.calls.some(x=>x.u.pathname.endsWith('/rpc/get_launch_health')));}finally{f.restore()}}
});
test('reconciliation endpoint rejects missing and forged worker tokens without claiming work',async()=>{
 const f=fixture();try{for(const token of [undefined,'f'.repeat(64)]){const req=request('POST');if(token)req.headers['x-reconciliation-token']=token;const res=response();await reconcile(req,res);assert.equal(res.statusCode,401);}assert.ok(!f.calls.some(x=>x.u.pathname.endsWith('/rpc/claim_payment_reconciliations')));}finally{f.restore()}
});
test('payment router preserves authorization and rejects unknown paths or query overrides',async()=>{
 for(const [url,status] of [['/api/payments/complete-card',401],['/api/payments/wire-settings',401],['/api/payments/unknown?action=config',404],['/api/payments/constructor',404]]){
  const req=request('POST');req.url=url;req.headers={};const res=response();await paymentRoute(req,res);assert.equal(res.statusCode,status);
 }
});
test('payment router preserves raw signed webhook payload and rejects forged signature',async()=>{
 const {default:Stripe}=await import('stripe');
 process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
 assert.equal(routeConfig.api.bodyParser,false);
 const raw='{ "id":"evt_fixture", "type":"unhandled.fixture", "data":{"object":{}} }';
 for(const valid of [true,false]){
  const req=Object.assign(Readable.from([Buffer.from(raw)]),{method:'POST',url:'/api/payments/stripe-webhook',headers:{'stripe-signature':valid?Stripe.webhooks.generateTestHeaderString({payload:raw,secret:'whsec_fixture'}):'forged'}});
  const res=response();await paymentRoute(req,res);assert.equal(res.statusCode,valid?200:400);
 }
});
