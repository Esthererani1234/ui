import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
import {bindCardIntent,recoverCardIntent} from '../server/lib/cardRecovery.js';
import {reconcileCardIntent} from '../server/lib/cardCapture.js';
import {stripeMatchesOrder,stripeState,requestHash,strictObject} from '../server/lib/security.js';
import {readJson,readRaw,json,assertPayable} from '../server/lib/payments.js';

// All provider and database calls are local fixtures. No network or credentials.
const U='10000000-0000-4000-8000-000000000001',H=requestHash('ctoken_fixture');
const order={id:1,user_id:U,total:100,order_number:'TEST',payment_method:'card',payment_status:'unpaid',status:'awaiting_payment',payment_provider:'stripe',provider_payment_id:null,price_locked_until:new Date(Date.now()+600000).toISOString()};
const intent={id:'pi_recovery',object:'payment_intent',amount:10000,amount_received:10000,currency:'usd',status:'succeeded',capture_method:'automatic',metadata:{order_id:'1',user_id:U,payment_claim:H}};
function harness({matches=[intent],canonical=intent,legacy=false,bindingError=false,request=true}={}) {
 const calls=[];let current={...order};
 const db={rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='get_card_payment_recovery')return {data:request?{request_hash:H,provider_payment_id:null,legacy}:null};
   if(name==='claim_card_payment_request')return {data:true};
   if(name==='bind_card_payment_intent') {
     if(bindingError)return {error:{code:'fixture_failure'}};
     current={...current,payment_status:'pending',provider_payment_id:args.p_intent_id};return {data:current};
   }
   if(name==='mark_payment_state'){current={...current,payment_status:args.p_payment_status};return {error:null};}
   throw new Error('Unexpected RPC '+name);
 },from:table=>{
   assert.equal(table,'app_settings');
   return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:false}})})})};
 }};
 const stripe={paymentIntents:{
   search:async args=>{calls.push({name:'search',args});return {data:matches,has_more:false}},
   retrieve:async id=>{calls.push({name:'retrieve',id});return canonical},
   create:async args=>{calls.push({name:'create',args});return canonical},
 }};
 return {db,stripe,calls,get current(){return current}};
}
test('binding preserves USD, exact cents, order owner and durable claim checks',async()=>{
 for(const change of [{currency:'eur'},{amount:9999},{amount:10000.1},{amount:0},{metadata:{...intent.metadata,user_id:'other'}},{metadata:{...intent.metadata,order_id:'2'}},{metadata:{...intent.metadata,payment_claim:'b'.repeat(64)}},{metadata:{order_id:'1',user_id:U}}]){
   const h=harness();await assert.rejects(bindCardIntent({db:h.db,order,intent:{...intent,...change},requestHash:H}));assert.equal(h.calls.length,0);
 }
});
test('eventually consistent empty search retains claim; later unique canonical intent binds and settles without create',async()=>{
 const h=harness({matches:[]});await assert.rejects(recoverCardIntent({...h,order}),/further reconciliation/);
 assert.deepEqual(h.calls.map(c=>c.name),['get_card_payment_recovery','search']);
 const found=harness();const recovered=await recoverCardIntent({...found,order});
 await reconcileCardIntent({...found,...recovered});
 assert.equal(found.current.payment_status,'paid');assert.equal(found.calls.some(c=>c.name==='create'),false);
 assert.ok(found.calls.find(c=>c.name==='search').args.query.includes(H));
 assert.equal(found.calls.find(c=>c.name==='bind_card_payment_intent').args.p_amount_cents,10000);
});
test('ambiguous search and legacy claims never create, bind, cancel or release a payment',async()=>{
 for(const options of [{matches:[]},{matches:[intent,{...intent,id:'pi_second'}]},{legacy:true}]){
   const h=harness(options);await assert.rejects(recoverCardIntent({...h,order}));
   assert.ok(h.calls.every(c=>['get_card_payment_recovery','search'].includes(c.name)));
 }
});
test('search result is retrieved canonically and mismatched currency, cents, owner or claim cannot bind',async()=>{
 for(const change of [{currency:'eur'},{amount:1},{metadata:{...intent.metadata,user_id:'other'}},{metadata:{...intent.metadata,payment_claim:'c'.repeat(64)}}]){
  const h=harness({canonical:{...intent,...change}});await assert.rejects(recoverCardIntent({...h,order}));
  assert.deepEqual(h.calls.map(c=>c.name),['get_card_payment_recovery','search','retrieve']);
 }
});
test('settlement still requires the full amount received after successful binding',async()=>{
 const h=harness({canonical:{...intent,amount_received:9999}});const recovered=await recoverCardIntent({...h,order});
 await assert.rejects(reconcileCardIntent({...h,...recovered}),/fully settled/);
 assert.equal(h.calls.some(c=>c.name==='mark_payment_state'),false);
});

async function loadHandler(path,dependencies) {
 const source=(await readFile(new URL(path,import.meta.url),'utf8'))
   .replace(/^import[\s\S]*?from\s*["'][^"']+["'];\n/gm,'')
   .replace('export const config','const config').replace('export default async function handler','async function handler');
 return new Function(...Object.keys(dependencies),source+'\nreturn handler;')(...Object.values(dependencies));
}
const response=()=>({status(code){this.statusCode=code;return this},setHeader(){return this},end(body){this.body=JSON.parse(body)}});
const request=body=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method:'POST',headers:{}});
test('confirm-card cannot report success when a settled intent fails atomic binding',async()=>{
 process.env.STRIPE_ENABLED='true';process.env.STRIPE_SECRET_KEY='sk_test_fixture';
 const h=harness({bindingError:true});
 const handler=await loadHandler('../server/payments/confirm-card.js',{
  service:()=>h.db,rateLimit:async()=>{},strictObject,securityLog:()=>{},requestHash,
  Stripe:class{constructor(){return h.stripe}},reconcileCardIntent,bindCardIntent,assertPayable,
  authenticateCustomer:async()=>({user:{id:U}}),customerOrder:async()=>order,json,readJson,
 });
 const res=response();await handler(request({order_id:1,confirmation_token_id:'ctoken_fixture'}),res);
 assert.equal(res.statusCode,500);assert.match(res.body.error,/Check your order/);
 assert.equal(h.calls.some(c=>c.name==='release_card_payment'),false);
 assert.equal(h.calls.find(c=>c.name==='create').args.metadata.payment_claim,H);
});
test('a signed success webhook recovers an unbound intent before applying its payment event',async()=>{
 process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
 const h=harness();h.db.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:order})})})});
 h.stripe.webhooks=Stripe.webhooks;
 let applied=false;
 const handler=await loadHandler('../server/payments/stripe-webhook.js',{
   Stripe:class{constructor(){return h.stripe}},service:()=>h.db,json,readRaw,securityLog:()=>{},stripeState,stripeMatchesOrder,
   bindCardIntent,reconcileCardIntent,applyPaymentEvent:async(...args)=>{assert.equal(h.current.provider_payment_id,intent.id);assert.equal(args[4],intent.id);applied=true;return true},
 });
 const event={id:'evt_recovered',type:'payment_intent.succeeded',data:{object:intent}};
 const raw=JSON.stringify(event),req=Object.assign(Readable.from([Buffer.from(raw)]),{method:'POST',headers:{'stripe-signature':Stripe.webhooks.generateTestHeaderString({payload:raw,secret:'whsec_fixture'})}});
 const res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(applied,true);
 assert.deepEqual(h.calls.map(c=>c.name),['retrieve','bind_card_payment_intent']);
});
