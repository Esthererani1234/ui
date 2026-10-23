import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {VERSION,archive,validateSubmission,wireDeadline,transition,visibleStatus,disclosureReleaseGate} from './contracts.mjs';
const now='2026-10-23T16:00:00Z';
const session={authenticated:true,userId:'customer-a',emailVerified:true,smsVerified:true};
const bundle={version:VERSION,hash:archive('test-bundle')};
function quote(){return {id:'q1',userId:'customer-a',createdAt:now,expiresAt:'2026-10-23T16:10:00Z',status:'open',paymentMethod:'card',items:[{available:true,quantity:2,unitCents:500000}],shippingCents:3500,surchargeCents:0,discountCents:0,totalCents:1003500,fingerprint:'server-cart-fingerprint',tax:{status:'approved_exempt',quoteFingerprint:'server-cart-fingerprint',amountCents:0,expiresAt:'2026-10-23T16:10:00Z'}};}
function input(){return {session,quote:quote(),body:{quoteId:'q1',accepted:true,version:VERSION,bundleHash:bundle.hash},bundle,now};}
const calendar={'2026-10-24':false,'2026-10-25':false,'2026-10-26':true,'2026-10-27':true};
const admin={authenticated:true,kind:'admin',strongAuth:true};
const customer={authenticated:true,kind:'customer',userId:'customer-a'};
const provider={authenticated:true,kind:'payment_adapter',verifiedEvidence:true};
function order(){return {userId:'customer-a',contract:'submitted',payment:'unpaid',fulfillment:'unshipped',offerExpiresAt:'2026-10-23T16:10:00Z',bundleHash:bundle.hash,totalCents:1003500,paymentMethod:'card',riskHold:false};}
const accept={type:'accept',noticeId:'notice-1',bundleHash:bundle.hash};
test('valid server quote produces exact consent evidence',()=>{const r=validateSubmission(input());assert.equal(r.totalCents,1003500);assert.equal(r.acknowledgmentHash,archive(r.acknowledgment));assert.equal(r.customerAssentedAt,now);});
for(const [name,mutate,code] of [
 ['client total injection',i=>i.body.total=1,'unexpected_fields'],
 ['another customer quote',i=>i.quote.userId='customer-b','not_found'],
 ['unverified SMS',i=>i.session={...session,smsVerified:false},'verification_required'],
 ['unchecked terms',i=>i.body.accepted=false,'new_assent_required'],
 ['stale version',i=>i.body.version='old','new_assent_required'],
 ['tampered archive hash',i=>i.body.bundleHash='x','new_assent_required'],
 ['exact expiry boundary',i=>i.now=i.quote.expiresAt,'quote_expired_or_used'],
 ['used quote',i=>i.quote.status='used','quote_expired_or_used'],
 ['extended quote',i=>i.quote.expiresAt='2026-10-23T17:00:00Z','invalid_quote_window'],
 ['future created quote',i=>i.quote.createdAt='2026-10-23T16:01:00Z','invalid_quote_window'],
 ['out of stock',i=>i.quote.items[0].available=false,'invalid_items'],
 ['fractional quantity',i=>i.quote.items[0].quantity=.5,'invalid_items'],
 ['total mismatch',i=>i.quote.totalCents=1,'total_mismatch'],
 ['unknown tax',i=>i.quote.tax.status='unknown','tax_review_required'],
 ['tax from another cart',i=>i.quote.tax.quoteFingerprint='different','tax_review_required'],
 ['expired tax',i=>i.quote.tax.expiresAt=now,'tax_review_required'],
 ['generic card fee blocked',i=>{i.quote.surchargeCents=40000;i.quote.totalCents+=40000},'surcharge_requires_separate_approved_integration'],
 ['crypto disabled',i=>i.quote.paymentMethod='crypto','method_disabled'],
 ['check disabled',i=>i.quote.paymentMethod='check','method_disabled'],
 ['wire missing acknowledgment',i=>{i.quote.paymentMethod='wire';i.quote.wireDueAt='2026-10-27T21:00:00Z'},'wire_assent_required']
]) test(name,()=>{const i=input();mutate(i);assert.throws(()=>validateSubmission(i),new RegExp(code));});
test('wire acknowledged exact server deadline',()=>{const i=input();i.quote.paymentMethod='wire';i.quote.wireDueAt=wireDeadline(now,calendar);i.body.wireAcknowledged=true;i.body.wireDueAt=i.quote.wireDueAt;assert.equal(validateSubmission(i).wireDueAt,'2026-10-27T21:00:00.000Z');});
test('weekend deadline',()=>assert.equal(wireDeadline(now,calendar),'2026-10-27T21:00:00.000Z'));
test('holiday calendar is explicit',()=>assert.equal(wireDeadline('2026-11-25T19:00:00Z',{'2026-11-26':false,'2026-11-27':true,'2026-11-28':false,'2026-11-29':false,'2026-11-30':true}),'2026-11-30T22:00:00.000Z'));
test('DST spring boundary',()=>assert.equal(wireDeadline('2026-03-06T22:00:00Z',{'2026-03-07':false,'2026-03-08':false,'2026-03-09':true,'2026-03-10':true}),'2026-03-10T21:00:00.000Z'));
test('DST fall boundary',()=>assert.equal(wireDeadline('2026-10-30T20:00:00Z',{'2026-10-31':false,'2026-11-01':false,'2026-11-02':true,'2026-11-03':true}),'2026-11-03T22:00:00.000Z'));
test('unapproved calendar fails closed',()=>assert.throws(()=>wireDeadline(now,{}),/calendar_not_approved/));
test('customer cannot accept own offer',()=>assert.throws(()=>transition(order(),accept,customer,now),/invalid_transition/));
test('other customer cannot withdraw',()=>assert.throws(()=>transition(order(),{type:'withdraw'},{...customer,userId:'b'},now),/not_found/));
test('unaccepted offer withdrawal',()=>assert.equal(transition(order(),{type:'withdraw'},customer,now).contract,'withdrawn'));
test('expired offer cannot be accepted',()=>assert.throws(()=>transition(order(),accept,admin,'2026-10-23T16:10:00Z'),/offer_expired/));
test('strong admin authentication required',()=>assert.throws(()=>transition(order(),accept,{...admin,strongAuth:false},now),/invalid_transition/));
test('acceptance must match archived bundle',()=>assert.throws(()=>transition(order(),{...accept,bundleHash:'other'},admin,now),/acceptance_record_required/));
test('deadline change requires renewed wire assent',()=>assert.throws(()=>transition({...order(),paymentMethod:'wire',wireDueAt:'2026-10-26T21:00:00Z'},{...accept,calendar},admin,now),/deadline_changed_reconsent/));
test('browser payment success cannot mark paid',()=>assert.throws(()=>transition(order(),{type:'payment_verified'},customer,now),/trusted_payment_required/));
test('mismatched payment rejected',()=>assert.throws(()=>transition(order(),{type:'payment_verified',providerEventId:'evt',currency:'usd',amountCents:1},provider,now),/payment_mismatch/));
test('late payment never resurrects cancelled contract',()=>{const r=transition({...order(),contract:'cancelled'},{type:'payment_verified',providerEventId:'evt',currency:'usd',amountCents:1003500},provider,now);assert.equal(r.contract,'cancelled');assert.equal(r.payment,'unpaid');assert.equal(r.refundReview,true);});
test('risk hold blocks shipping',()=>assert.throws(()=>transition({...order(),contract:'accepted',payment:'verified',riskHold:true},{type:'ship',tracking:'test'},admin,now),/fulfillment_blocked/));
test('payment alone is not acceptance',()=>{const r=transition(order(),{type:'payment_verified',providerEventId:'evt',currency:'usd',amountCents:1003500},provider,now);assert.equal(r.contract,'submitted');assert.throws(()=>transition(r,{type:'ship',tracking:'test'},admin,now),/fulfillment_blocked/);});
test('simulated accepted paid shipped delivered refunded journey',()=>{let r=transition(order(),accept,admin,now);r=transition(r,{type:'payment_verified',providerEventId:'evt-pay',currency:'usd',amountCents:1003500},provider,now);r=transition(r,{type:'ship',tracking:'TEST-ONLY'},admin,now);r=transition(r,{type:'deliver'},admin,now);r=transition(r,{type:'refund',providerEventId:'evt-refund',currency:'usd',amountCents:1003500},provider,now);assert.equal(visibleStatus(r),'Refunded');assert.equal(r.fulfillment,'delivered');});
test('unapproved legal release cannot activate',()=>assert.throws(()=>disclosureReleaseGate({ownerApproved:true}),/release_blocked:attorneyApproved/));
test('ledger rejects unauthorized roles, archive edits and duplicates',async()=>{
 const db=new PGlite();try {
  await db.exec(readFileSync(new URL('./ledger.draft.sql',import.meta.url),'utf8'));
  await db.exec("create role legal_test_customer; create role legal_test_anon;");
  for(const role of ['legal_test_customer','legal_test_anon']) {
   await db.exec(`set role ${role}`);
   await assert.rejects(db.query('select * from legal_draft.consents'),/permission denied/);
   await assert.rejects(db.query('select * from legal_draft.events'),/permission denied/);
   await db.exec('reset role');
  }
  await db.query('insert into legal_draft.bundles values($1,$2,$3,clock_timestamp())',[VERSION,bundle.hash,{text:'exact test document'}]);
  const sql="insert into legal_draft.consents(order_id,account_id,quote_id,version,bundle_hash,acknowledgment,exact_quote,total_cents,payment_method,offer_expires_at) values($1,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',$2,$3,'exact acknowledgment','{}',100,'card',clock_timestamp()+interval '10 minutes')";
  await db.query(sql,[1,VERSION,bundle.hash]);
  await assert.rejects(db.query(sql,[2,VERSION,bundle.hash]),/unique/);
  await assert.rejects(db.query("update legal_draft.consents set total_cents=1"),/append-only/);
  await assert.rejects(db.query("delete from legal_draft.bundles"),/append-only/);
  const event="insert into legal_draft.events(order_id,event_key,event_type,actor_kind,actor_id,evidence) values(1,$1,'company_accepted','admin','test-admin','{}')";
  await db.query(event,['accept-1']);
  await assert.rejects(db.query(event,['accept-1']),/unique/);
  await assert.rejects(db.query(event,['accept-2']),/unique/);
  await assert.rejects(db.query("update legal_draft.events set actor_id='tampered'"),/append-only/);
  await db.exec('grant usage on schema legal_draft to legal_test_customer; grant select on all tables in schema legal_draft to legal_test_customer; set role legal_test_customer');
  assert.equal((await db.query('select * from legal_draft.consents')).rows.length,0);
  assert.equal((await db.query('select * from legal_draft.events')).rows.length,0);
  await assert.rejects(db.query("insert into legal_draft.events(order_id,event_key,event_type,actor_kind,actor_id,evidence) values(1,'forged','refund','admin','fake','{}')"),/permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query('select acknowledgment from legal_draft.consents where order_id=1')).rows[0].acknowledgment,'exact acknowledgment');
 } finally{await db.close();}
});

test('all sixteen exact policy archives match their hashes',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../legal-bundle.json',import.meta.url),'utf8'));
 assert.equal(manifest.documents.length,16);assert.equal(manifest.status,'DRAFT_NOT_EFFECTIVE');assert.equal(manifest.effectiveDate,null);
 const sorted=manifest.documents.map(d=>Object.fromEntries(Object.keys(d).sort().map(k=>[k,d[k]])));
 assert.equal(archive(JSON.stringify(sorted)),manifest.bundleHash);
 for(const d of manifest.documents){const exact=readFileSync(new URL('../'+d.path,import.meta.url),'utf8');assert.equal(d.text,exact);assert.equal(d.sha256,archive(exact));assert.match(exact,/DRAFT — NOT EFFECTIVE/);}
});
test('production build contains no new draft bundle or preview',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../legal-bundle.json',import.meta.url),'utf8'));
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
 for(const file of walk('dist')){if(/\.(js|html|json|css)$/.test(file)){const text=readFileSync(file,'utf8');assert.ok(!text.includes(manifest.bundleHash),file);assert.ok(!text.includes('PRIVATE REVIEW COPY'),file);assert.ok(!text.includes(VERSION),file);}}
});
