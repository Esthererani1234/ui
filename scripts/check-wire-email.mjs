import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EMAIL_EVENTS,renderOrderEmail,sampleOrder} from '../supabase/functions/_shared/orderEmail.js';
import {deliverOrderEmails} from '../supabase/functions/_shared/orderEmailDelivery.js';

// All bank details and provider calls in this suite are fixtures. No network.
const bank = {bank_name:'Fixture Bank',beneficiary_name:'Fixture Metals LLC',routing_number:'021000021',account_number:'000012345678',swift_code:'TESTUS00',bank_address:'123 Fixture Avenue\nNew York, NY 10001'};
const settings = {enabled:true,api_key:'fixture-only',from_email:'orders@goldonthespot.com',reply_to:'support@goldonthespot.com'};
function sample() {
  const value=sampleOrder();
  return {...value,wire:structuredClone(bank),order:{...value.order,payment_method:'wire',total:'4160.09',payment_reference:'WIRE-00042',payment_due_at:'2099-07-15T21:30:00Z',wire_agreement_text:'I agree to pay by wire.\nSecond paragraph <kept verbatim> & complete.',wire_agreement_version:'wire-v2'}};
}
const render = value => renderOrderEmail({event:'wire_instructions',...value});

test('wire HTML and plain text contain complete instructions, exact total/reference, images and saved agreement',()=>{
  const mail=render(sample());
  for (const body of [mail.html,mail.text]) {
    for (const value of ['Fixture Bank','Fixture Metals LLC','021000021','000012345678','TESTUS00','123 Fixture Avenue','$4,160.09 USD','WIRE-00042','Domestic wire ABA routing number','SWIFT / BIC (international wires only)','America/New_York','5:30:00 PM EDT','wire-v2','Please send','Do not send an ACH transfer','sign in to your account','not confirmation of payment or a guarantee of delivery']) assert.ok(body.includes(value),value);
  }
  assert.match(mail.html,/<img src="https:\/\/goldonthespot.com\/images\/buffalo-hero-480-v1.webp"/);
  assert.ok(mail.text.includes(sample().order.wire_agreement_text));
  assert.match(mail.html,/&lt;kept verbatim&gt; &amp; complete/);
  assert.match(mail.subject,/Wire payment instructions/);
});
test('deadline uses New York daylight/standard time, including date rollover',()=>{
  const value=sample();value.order.payment_due_at='2099-01-16T02:30:00Z';
  const mail=render(value);
  assert.match(mail.text,/January 15, 2099 at 9:30:00 PM EST \(America\/New_York\)/);
});
test('optional SWIFT/agreement are omitted and reference falls back to order number',()=>{
  const value=sample();delete value.wire.swift_code;delete value.order.payment_reference;delete value.order.wire_agreement_text;delete value.order.wire_agreement_version;
  for(const body of [render(value).html,render(value).text]){assert.ok(!body.includes('SWIFT'));assert.ok(!body.includes('agreement copy'));assert.ok(body.includes('GOTS-PREVIEW'));}
});
test('untrusted bank, agreement and reference HTML is escaped and external product pictures are blocked',()=>{
  const value=sample();value.wire.bank_name='<script>bank</script>';value.order.payment_reference='<img src=x onerror=1>';value.order.wire_agreement_version='"<script>version</script>';value.items[0].product_image_url='https://attacker.example/track';
  const mail=render(value);assert.ok(!mail.html.includes('<script>'));assert.ok(!mail.html.includes('<img src=x'));assert.ok(!mail.html.includes('attacker.example'));assert.match(mail.html,/&lt;script&gt;bank/);
});
test('all existing events still render without a wire parameter',()=>{
  for(const event of ['placed','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','tracking']){
    assert.ok(EMAIL_EVENTS[event]);const {order,items}=sampleOrder();const mail=renderOrderEmail({event,order,items});assert.ok(mail.text.includes('$4,160.00'));assert.ok(!mail.text.includes('BANK WIRE INSTRUCTIONS'));
  }
});
test('all admin event previews use synthetic data without needing a secret',()=>{
  for(const event of Object.keys(EMAIL_EVENTS)){
    const mail=renderOrderEmail({event,...sampleOrder()});assert.ok(mail.html);assert.ok(mail.text);
    for(const body of [mail.html,mail.text]){
      if(event==='wire_instructions'){
        assert.match(body,/PREVIEW ONLY, DO NOT SEND FUNDS/);
        assert.match(body,/Payment method: Bank wire/);
        assert.ok(!body.includes('Credit / debit card'));
      }else{
        assert.match(body,/Payment method: Credit \/ debit card/);
        assert.ok(!body.includes('Bank wire instructions'));
        assert.ok(!body.includes('Fixture Bank'));
        assert.ok(!body.includes('PREVIEW ONLY, DO NOT SEND FUNDS'));
      }
    }
  }
});
test('shipping address supports stored and legacy field names with HTML escaping',()=>{
  for(const event of ['placed','wire_instructions'])for(const fields of [
    {address_line_1:'42 Stored <Street>',address_line_2:'Suite & 2'},
    {line1:'42 Stored <Street>',line2:'Suite & 2'},
    {address_line_1:'42 Stored <Street>',address_line_2:'Suite & 2',line1:'OLD ADDRESS',line2:'OLD UNIT'},
  ]){
    const value=sample();value.order.shipping_address={...fields,city:'New York',state:'NY',postal_code:'10001',country:'US'};
    const mail=renderOrderEmail({event,...value});assert.match(mail.text,/42 Stored <Street>/);assert.match(mail.text,/Suite & 2/);assert.match(mail.html,/42 Stored &lt;Street&gt;/);assert.match(mail.html,/Suite &amp; 2/);assert.ok(!mail.html.includes('OLD ADDRESS'));assert.match(mail.text,/New York, NY, 10001/);
  }
});
test('incomplete bank or invalid amount/reference/deadline cannot render a wire request',()=>{
  for(const field of ['bank_name','beneficiary_name','routing_number','account_number']){
    const value=sample();value.wire[field]=' ';assert.throws(()=>render(value),{code:'wire_instructions_unavailable'});
  }
  for(const wire of [undefined,null,{},'secret', {...bank,routing_number:'123'}, {...bank,account_number:'123'}, {...bank,swift_code:{}}]) assert.throws(()=>render({...sample(),wire}),{code:'wire_instructions_unavailable'});
  for(const total of [undefined,null,'',0,-1,'NaN',Infinity,'4160.009']){const value=sample();value.order.total=total;assert.throws(()=>render(value),{code:'wire_instructions_unavailable'});}
  for(const due of [undefined,null,'','invalid','2099-01-01','2099-01-01T12:00:00']){const value=sample();value.order.payment_due_at=due;assert.throws(()=>render(value),{code:'wire_instructions_unavailable'});}
  const value=sample();value.order.payment_reference=' ';assert.throws(()=>render(value),{code:'wire_instructions_unavailable'});
});

test('domestic wire receipt sends without optional bank address and preserves required bank fields',()=>{
  for(const address of [undefined,null,'',' ']){
    const value=sample();value.wire.bank_address=address;
    const mail=render(value);
    assert.match(mail.subject,/Order received/);
    assert.match(mail.text,/Thank you/);
    assert.ok(!mail.text.includes('Bank address:'));
    assert.match(mail.text,/021000021/);
    assert.match(mail.text,/000012345678/);
  }
  const value=sample();value.wire.bank_address={};
  assert.throws(()=>render(value),{code:'wire_instructions_unavailable'});
});

function fixture(overrides={}) {
  const value=sample();
  const state={job:{id:'fixture-wire',order_id:42,lease_id:'lease-1',attempts:1,event_type:'wire_instructions',recipient:'verified@example.test',order_snapshot:value.order,items_snapshot:value.items,status:'sending',message:null},current:{payment_method:'wire',payment_status:'unpaid',status:'awaiting_payment',payment_due_at:value.order.payment_due_at},bank:structuredClone(bank),requests:[],calls:[],...overrides};
  state.db={
    async rpc(name){state.calls.push(name);if(name==='claim_order_emails')return {data:[structuredClone(state.job)]};assert.equal(name,'get_wire_instructions_secret');return {data:state.bank,error:state.bankError};},
    from(table){
      if(table==='orders')return {
        select(fields){
          assert.equal(fields,'payment_method,payment_status,status,payment_due_at');
          return {eq(key,id){
            assert.equal(key,'id');assert.equal(id,state.job.order_id);
            return {async maybeSingle(){state.calls.push('read_order');return {data:state.current,error:state.orderError};}};
          }};
        },
      };
      assert.equal(table,'order_email_outbox');
      return {update(values){const filters=[];const perform=()=>{
        state.calls.push(values.message?'persist_message':`update_${values.status}`);
        if(values.message && state.saveFailure)return {error:new Error('fixture write failed')};
        if(values.status==='sent' && state.ackFailure){state.ackFailure=false;return {error:new Error('fixture ack failed')};}
        if(values.status==='skipped' && state.skipFailure)return {error:new Error('fixture skip failed')};
        if(filters.some(([key,value])=>state.job[key]!==value))return {data:null};
        Object.assign(state.job,structuredClone(values));return {data:{id:state.job.id},error:null};
      };const query={eq(key,value){filters.push([key,value]);return query;},is(key,value){filters.push([key,value]);return query;},select(){return query;},async maybeSingle(){return perform();},then(resolve,reject){return Promise.resolve().then(perform).then(resolve,reject);}};return query;}};
    },
  };
  state.options={pause:async()=>{},send:async(_settings,message,key)=>{
    assert.deepEqual(message,state.job.message,'message must be durable before contacting provider');
    state.calls.push('send');state.requests.push({message:structuredClone(message),key});
    if(state.sendFailure)throw Object.assign(new Error('PRIVATE PROVIDER DETAILS'),{code:'provider_500'});
    return 'fixture-provider-id';
  }};
  state.run=(config=settings)=>deliverOrderEmails(state.db,config,state.options);
  state.reclaim=()=>{state.job.status='sending';state.job.attempts++;state.job.lease_id=`lease-${state.job.attempts}`;};
  return state;
}
test('worker uses only secret RPC bank data and persists before sending',async()=>{
  const f=fixture();f.job.order_snapshot.wire={...bank,bank_name:'ATTACKER BANK'};f.job.order_snapshot.bank_name='ATTACKER BANK';f.bank=JSON.stringify(bank);
  assert.deepEqual(await f.run(),{enabled:true,sent:1,failed:0});
  assert.deepEqual(f.calls,['claim_order_emails','read_order','get_wire_instructions_secret','persist_message','send','update_sent']);
  assert.equal(f.requests.length,1);assert.ok(!f.requests[0].message.html.includes('ATTACKER BANK'));assert.deepEqual(f.requests[0].message.to,['verified@example.test']);assert.equal(f.requests[0].key,'gots-order-fixture-wire');
});
test('account alerts use the durable delivery path without accessing order or bank details',async()=>{
  const f=fixture();f.job.account_user_id='fixture-user';f.job.order_id=null;f.job.event_type='account_password_changed';f.job.order_snapshot={occurred_at:'2026-10-23T14:00:00Z'};
  assert.deepEqual(await f.run(),{enabled:true,sent:1,failed:0});
  assert.ok(!f.calls.includes('read_order'));assert.ok(!f.calls.includes('get_wire_instructions_secret'));
  assert.match(f.requests[0].message.subject,/password was changed/);
});
test('missing/malformed/partial bank configuration or RPC failure retries without preparing or sending',async()=>{
  for(const overrides of [{bank:null},{bank:'not json'},{bank:{}},{bank:{...bank,account_number:''}},{bankError:new Error('SECRET DETAILS')}]){
    const f=fixture(overrides);const result=await f.run();assert.equal(result.failed,1);assert.equal(f.job.status,'pending');assert.equal(f.job.last_error,'wire_instructions_unavailable');assert.equal(f.job.message,null);assert.equal(f.requests.length,0);assert.ok(!f.calls.includes('persist_message'));
  }
  const f=fixture({bank:null});f.job.attempts=10;await f.run();assert.equal(f.job.status,'failed');
});
test('missing/failed current-order read and missing deadline retry without accessing bank or sending',async()=>{
  for(const overrides of [{current:null},{orderError:new Error('PRIVATE')},{current:{payment_method:'wire',payment_status:'unpaid',status:'awaiting_payment',payment_due_at:null}}]){
    const f=fixture(overrides);await f.run();assert.equal(f.job.status,'pending');assert.equal(f.job.last_error,'wire_order_unavailable');assert.equal(f.requests.length,0);assert.ok(!f.calls.includes('get_wire_instructions_secret'));
  }
});
test('only eligible order and payment status combinations prepare wire instructions',async()=>{
  for(const status of ['pending_review','awaiting_payment'])for(const payment_status of ['unpaid','pending','failed','partially_paid']){
    const f=fixture();Object.assign(f.current,{status,payment_status});await f.run();
    assert.equal(f.job.status,'sent',`${status}/${payment_status}`);assert.equal(f.requests.length,1);
  }
});
test('ineligible or unknown states skip before first preparation, including preparation retries',async()=>{
  const changes=[
    ...['paid','refunded','expired','disputed','confirming','processing','unknown','',null,undefined].map(payment_status=>({payment_status})),
    ...['cancelled','expired','completed','shipped','processing','disputed','confirming','unknown','',null,undefined].map(status=>({status})),
    {payment_method:'card'},{payment_due_at:'2000-01-01T00:00:00Z'},
  ];
  for(const change of changes){
    const f=fixture();Object.assign(f.current,change);f.job.attempts=3;await f.run();assert.equal(f.job.status,'skipped');assert.equal(f.job.last_error,'wire_order_stale');assert.equal(f.job.message,null);assert.equal(f.requests.length,0);assert.ok(!f.calls.includes('get_wire_instructions_secret'));
  }
  const f=fixture();f.job.order_snapshot.payment_due_at='2000-01-01T00:00:00Z';await f.run();assert.equal(f.job.status,'skipped');
});
test('skip write or payload persistence failure never permits an email send',async()=>{
  const f=fixture({saveFailure:true});await f.run();assert.equal(f.job.last_error,'payload_save_failed');assert.equal(f.job.message,null);assert.equal(f.requests.length,0);
  const g=fixture({skipFailure:true});g.current.payment_status='paid';await g.run();assert.equal(g.job.last_error,'wire_skip_failed');assert.equal(g.requests.length,0);
});
test('uncertain accepted send retains identical payload and key despite changed order, secret, snapshots and sender',async()=>{
  for(const failure of ['ackFailure','sendFailure']){
    const f=fixture({[failure]:true});await f.run();assert.equal(f.job.status,'pending');assert.ok(f.job.message);const persisted=structuredClone(f.job.message);
    f.reclaim();f.sendFailure=false;f.current.payment_status='paid';f.current.status='cancelled';f.current.payment_due_at='2000-01-01T00:00:00Z';f.bank=null;f.bankError=new Error('Bank offline');f.orderError=new Error('Order offline');f.job.order_snapshot.total=1;f.job.order_snapshot.payment_reference='CHANGED';f.job.order_snapshot.wire_agreement_text='CHANGED';f.job.items_snapshot=[];f.calls=[];
    await f.run({...settings,from_email:'changed@example.test',reply_to:'changed@example.test'});
    assert.deepEqual(f.requests[0],f.requests[1]);assert.deepEqual(f.job.message,persisted);assert.equal(f.job.status,'sent');assert.deepEqual(f.calls,['claim_order_emails','send','update_sent']);
  }
});
test('bank configuration can recover before first preparation, with stale state rechecked',async()=>{
  const f=fixture({bank:null});await f.run();f.reclaim();f.bank=bank;await f.run();assert.equal(f.job.status,'sent');assert.equal(f.requests.length,1);
  const g=fixture({bank:null});await g.run();g.reclaim();g.bank=bank;g.current.payment_status='paid';await g.run();assert.equal(g.job.status,'skipped');assert.equal(g.requests.length,0);
});
test('non-wire messages preserve the original preparation path and never read wire secrets',async()=>{
  const f=fixture();f.job.event_type='paid';f.current=null;f.bank=null;await f.run();assert.equal(f.job.status,'sent');assert.ok(!f.calls.includes('read_order'));assert.ok(!f.calls.includes('get_wire_instructions_secret'));
});
