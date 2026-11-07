import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAchTotals, achPaymentIsConfirmed} from '../shared/achPayments.js';
test('ACH fee is 2% of merchandise, with integer cent rounding', () => {
  assert.deepEqual(calculateAchTotals({subtotalCents:100000,shippingCents:3500,taxCents:1000}),{subtotalCents:100000,shippingCents:3500,taxCents:1000,feeCents:2000,totalCents:106500});
});
test('ACH final total cannot exceed $25,000 including fee',()=>{
  assert.equal(calculateAchTotals({subtotalCents:2450980}).totalCents,2500000);
  assert.throws(()=>calculateAchTotals({subtotalCents:2450981}));
  assert.throws(()=>calculateAchTotals({subtotalCents:2500000}));
});
test('invalid monetary input is rejected',()=>{
  for(const subtotalCents of [NaN,Infinity,-1,0,1.5,'10000',Number.MAX_SAFE_INTEGER]) assert.throws(()=>calculateAchTotals({subtotalCents}));
});
const order={id:7,user_id:'customer-a',payment_method:'ach',payment_provider:'stripe',provider_payment_id:'pi_test',total:1020};
const intent={id:'pi_test',currency:'usd',amount:102000,amount_received:102000,status:'succeeded',payment_method_types:['us_bank_account'],metadata:{order_id:'7',user_id:'customer-a'}};
test('only matching settled ACH can be confirmed',()=>{
  assert.equal(achPaymentIsConfirmed(intent,order),true);
  for(const change of [{status:'processing'},{status:'requires_action'},{amount_received:0},{amount:1},{currency:'eur'},{id:'pi_other'},{payment_method_types:['card']},{metadata:{order_id:'7',user_id:'customer-b'}}]) assert.equal(achPaymentIsConfirmed({...intent,...change},order),false);
});
import {buildAchIntent,achSettlementState} from '../server/lib/achCheckout.js';
const payable={...order,order_number:'TEST',status:'awaiting_payment',payment_status:'unpaid',subtotal:1000,payment_surcharge:20,shipping_amount:0,price_locked_until:'2030-01-01T00:00:00Z'};
test('ACH intent uses only bank debits and the stored authoritative total',()=>{
  const params=buildAchIntent(payable,'ctoken_test','a'.repeat(64),0);
  assert.deepEqual(params.payment_method_types,['us_bank_account']);
  assert.equal(params.amount,102000);
  assert.equal(params.payment_method_options.us_bank_account.verification_method,'instant');
});
test('ACH rejects expired quote, duplicate payment, altered surcharge and final total',()=>{
  for(const change of [{price_locked_until:'1970-01-01T00:00:00Z'},{payment_status:'pending'},{payment_status:'paid'},{status:'cancelled'},{payment_surcharge:0},{total:1000},{payment_method:'card'}]) assert.throws(()=>buildAchIntent({...payable,...change},'ctoken_test','a'.repeat(64),1));
});
test('processing never reports a settled payment',()=>{
  assert.equal(achSettlementState({...intent,status:'processing'},order),'pending');
  assert.equal(achSettlementState(intent,order),'paid');
  assert.equal(achSettlementState({...intent,amount_received:0},order),'unconfirmed');
});
