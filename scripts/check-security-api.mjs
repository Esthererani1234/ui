import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {assertPayable,readJson,customerOrder} from '../server/lib/payments.js';
import {cleanCart} from '../server/lib/quotes.js';
import {strictObject,stripeState,stripeMatchesOrder,rateLimit} from '../server/lib/security.js';
const order={id:1,user_id:'test-user',total:100,payment_method:'card',payment_status:'unpaid',status:'awaiting_payment',price_locked_until:new Date(Date.now()+600000).toISOString()};
test('payment guard rejects cancelled, missing or expired locks and invalid totals',()=>{
 assert.doesNotThrow(()=>assertPayable(order,'card'));
 for(const change of [{status:'cancelled'},{status:'shipped'},{payment_status:'paid'},{price_locked_until:null},{price_locked_until:'bad date'},{price_locked_until:new Date(Date.now()-1).toISOString()},{total:-1},{total:'NaN'}]) assert.throws(()=>assertPayable({...order,...change},'card'));
});
test('strict payment payload rejects submitted amounts and privilege flags',()=>{
 for(const key of ['amount','total','paid','user_id','is_admin']) assert.throws(()=>strictObject({order_id:1,[key]:1},['order_id']));
 for(const value of [null,[],0,'text']) assert.throws(()=>strictObject(value,['order_id']));
});
test('cart schema rejects manipulated price, fractional or unsafe quantities',()=>{
 assert.deepEqual(cleanCart([{product_id:1,quantity:2}]),[{product_id:1,quantity:2}]);
 for(const cart of [[{product_id:1,quantity:1,unit_price:0.01}],[{product_id:1,quantity:0}],[{product_id:1,quantity:1.5}],[{product_id:1,quantity:101}],[null],[]]) assert.throws(()=>cleanCart(cart));
});
test('JSON parser rejects nonobjects, invalid JSON and oversized bodies',async()=>{
 for(const body of ['null','[]','{bad']) await assert.rejects(readJson(Readable.from([Buffer.from(body)])),{status:400});
 await assert.rejects(readJson(Readable.from([Buffer.alloc(100)]),10),{status:413});
});
test('unknown Stripe notifications and partial refunds do not change order state',()=>{
 assert.equal(stripeState('payment_intent.created',{}),null);
 assert.equal(stripeState('charge.refunded',{refunded:false}),null);
 assert.deepEqual(stripeState('charge.refunded',{refunded:true}),['refunded','refunded']);
 assert.equal(stripeState('checkout.session.completed',{payment_status:'unpaid'}),null);
});
test('Stripe settlement must match order, user, currency and exact cents',()=>{
 const intent={amount:10000,currency:'usd',metadata:{order_id:'1',user_id:'test-user'}};
 assert.equal(stripeMatchesOrder(intent,order),true);
 for(const change of [{amount:1},{amount:9999},{currency:'eur'},{metadata:{order_id:'2',user_id:'test-user'}},{metadata:{order_id:'1',user_id:'attacker'}}]) assert.equal(stripeMatchesOrder({...intent,...change},order),false);
});
test('rate limiter fails closed and exposes clean retry errors',async()=>{
 await rateLimit({rpc:async()=>({data:0})},'scope','user',5,60);
 await assert.rejects(rateLimit({rpc:async()=>({data:30})},'scope','user',5,60),{status:429,retryAfter:30});
 await assert.rejects(rateLimit({rpc:async()=>({data:null,error:{code:'database_unavailable'}})},'scope','user',5,60),{status:503});
});

test('admin displays safe server rejection rather than opaque transport error',async()=>{
 const {invokeFunction}=await import('../src/lib/functionRequest.js');
 const client={functions:{invoke:async()=>({error:{context:new Response(JSON.stringify({error:'Approve this order in the risk center.'}),{status:409})}})}};
 await assert.rejects(invokeFunction(client,'admin-operations',{}),{message:'Approve this order in the risk center.',status:409});
});

test('tracking form omits unchanged status/payment and explains shipment prerequisites',async()=>{
 const {orderChanges,orderStatusBlock}=await import('../src/lib/adminOrder.js');
 const row={id:1,status:'awaiting_payment',payment_status:'pending',tracking_number:'',internal_notes:'',risk_decision:'pending'};
 assert.deepEqual(orderChanges(row,{status:row.status,paymentStatus:row.payment_status,trackingNumber:'TRACK',internalNotes:'',reason:' tracking added '}),{order_id:1,tracking_number:'TRACK',reason:'tracking added'});
 assert.match(orderStatusBlock(row,'shipped','pending'),/payment/);
 assert.match(orderStatusBlock(row,'shipped','paid'),/Risk center/);
 assert.equal(orderStatusBlock({...row,risk_decision:'approved'},'shipped','paid'),'');
 assert.equal(orderStatusBlock(row,'cancelled','pending'),'');
});
