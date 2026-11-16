import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountOrders} from '../server/payments/account-orders.js';
const records=[{user_id:'a',order_number:'T-1'},{user_id:'a',order_number:'T-2'},{user_id:'b',order_number:'T-3'}];
async function run(url,{user='a',deny,fail=false}={}){
 let clientReads=0;const res={headers:{},status(n){this.code=n;return this},setHeader(k,v){this.headers[k]=v;return this},end(body){this.body=JSON.parse(body)}};
 const handler=accountOrders({authenticate:async(req,options)=>{
  assert.equal(options.requireSms,true);if(deny)throw Object.assign(Error('fixture'),{status:deny});return {user:{id:user},token:'fixture-access'};
 },readClient:token=>{
  assert.equal(token,'fixture-access');clientReads++;
  let rows=[...records];return {from:t=>{assert.equal(t,'orders');return {select(s){assert.match(s,/order_items!order_items_order_id_fkey\(/);assert.doesNotMatch(s,/internal_notes|provider_payment_id|terms_ip_hash/);return this},
   eq(k,v){rows=rows.filter(r=>r[k]===v);return this},limit(n){rows=rows.slice(0,n);return this},async order(){return {data:rows,error:fail?new Error('private diagnostics'):null}}}}};
 }});
 await handler({method:'GET',url,headers:{}},res);return {...res,clientReads};
}
test('history and receipts use the verified owner and ignore caller-supplied identity',async()=>{
 assert.deepEqual((await run('/?user_id=b')).body.orders,records.slice(0,2));
 assert.deepEqual((await run('/?order=T-2')).body.orders,[records[1]]);
 assert.deepEqual((await run('/?order=T-3')).body.orders,[]);
 assert.deepEqual((await run('/',{user:'new'})).body.orders,[]);
});
test('sign-in and SMS failures do not read orders, and data errors are not empty histories',async()=>{
 for(const deny of [401,403]){const r=await run('/',{deny});assert.equal(r.code,deny);assert.equal(r.clientReads,0);assert.equal(r.headers['cache-control'],'no-store')}
 const r=await run('/',{fail:true});assert.equal(r.code,503);assert.ok(!('orders' in r.body));assert.doesNotMatch(r.body.error,/private/);
});
