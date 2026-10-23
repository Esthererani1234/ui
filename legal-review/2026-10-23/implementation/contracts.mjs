// DRAFT REFERENCE CORE. Not imported by production. No HTTP, secrets or provider calls.
// session, quote, policy and event actors MUST come from authenticated server adapters.
import { createHash } from 'node:crypto';
export const VERSION = '2026-10-23-draft.1';
export const CHECKOUT_TEXT = 'I have read and agree to the Terms of Service, Customer Purchase Agreement, Market Loss and Price Lock Policy, and Refund, Return and Cancellation Policy. I understand that my submission is an offer and that a binding purchase agreement begins only when Gold On The Spot issues its definitive acceptance. After acceptance I must pay by the stated deadline; an unjustified cancellation or nonpayment may result in documented, legally recoverable losses. My mandatory consumer and payment-dispute rights remain protected.';
const fail = code => { throw new Error(code); };
const time = value => { const n=Date.parse(value); if(!Number.isFinite(n)) fail('invalid_time'); return n; };
const cents = value => { if(!Number.isSafeInteger(value)||value<0) fail('invalid_money'); return value; };
const strict = (body, keys) => {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!keys.includes(k))) fail('unexpected_fields');
};
export function archive(text) { return createHash('sha256').update(text,'utf8').digest('hex'); }
export function taxGate({status, quoteFingerprint, expectedFingerprint, amountCents, expiresAt}, now) {
  if(!['calculated','approved_exempt','approved_no_collection'].includes(status) || !quoteFingerprint || quoteFingerprint!==expectedFingerprint || time(expiresAt)<=time(now)) fail('tax_review_required');
  if(status!=='calculated' && amountCents!==0) fail('invalid_exemption_amount');
  return cents(amountCents);
}
export function validateSubmission({session, quote, body, bundle, now}) {
  strict(body,['quoteId','accepted','version','bundleHash','wireAcknowledged','wireDueAt']);
  if(!session?.authenticated || !session.emailVerified || !session.smsVerified) fail('verification_required');
  if(quote.userId!==session.userId || body.quoteId!==quote.id) fail('not_found');
  if(time(quote.createdAt)>time(now) || time(quote.expiresAt)-time(quote.createdAt)>600_000) fail('invalid_quote_window');
  if(quote.status!=='open' || time(quote.expiresAt)<=time(now)) fail('quote_expired_or_used');
  if(body.accepted!==true || body.version!==bundle.version || body.bundleHash!==bundle.hash || bundle.version!==VERSION) fail('new_assent_required');
  if(!['wire','card'].includes(quote.paymentMethod)) fail('method_disabled');
  if(!Array.isArray(quote.items)||!quote.items.length) fail('invalid_items');
  let subtotal=0;
  for(const item of quote.items) {
    if(!item.available || !Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100) fail('invalid_items');
    subtotal+=cents(item.unitCents)*item.quantity;
    if(!Number.isSafeInteger(subtotal)) fail('invalid_money');
  }
  const tax=taxGate({...quote.tax,expectedFingerprint:quote.fingerprint},now);
  const total=subtotal+cents(quote.shippingCents)+cents(quote.surchargeCents)+tax-cents(quote.discountCents);
  if(!Number.isSafeInteger(total)||total<=0 || total!==quote.totalCents) fail('total_mismatch');
  if(quote.surchargeCents!==0 && quote.paymentMethod==='card') fail('surcharge_requires_separate_approved_integration');
  if(quote.paymentMethod==='wire' && (body.wireAcknowledged!==true || body.wireDueAt!==quote.wireDueAt || time(quote.wireDueAt)<=time(now))) fail('wire_assent_required');
  return Object.freeze({userId:session.userId,quoteId:quote.id,paymentMethod:quote.paymentMethod,totalCents:total,
    version:bundle.version,bundleHash:bundle.hash,acknowledgment:CHECKOUT_TEXT,acknowledgmentHash:archive(CHECKOUT_TEXT),
    customerAssentedAt:now,offerExpiresAt:quote.expiresAt,wireDueAt:quote.wireDueAt??null});
}
// Proposed business-day rule: acceptance day excluded; 17:00 Eastern second approved
// receiving-bank business day. Calendar must explicitly cover every traversed day.
export function wireDeadline(acceptedAt, calendar) {
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=Object.fromEntries(fmt.formatToParts(new Date(time(acceptedAt))).map(p=>[p.type,p.value]));
  let day=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`), count=0;
  for(let i=0;i<30&&count<2;i++) {
    day.setUTCDate(day.getUTCDate()+1);
    const key=day.toISOString().slice(0,10);
    if(!calendar || !Object.hasOwn(calendar,key) || typeof calendar[key]!=='boolean') fail('calendar_not_approved');
    if(calendar[key]) count++;
  }
  if(count!==2) fail('calendar_not_approved');
  const target=day.toISOString().slice(0,10);
  // Noon UTC is always same Eastern calendar day. Determine that day's UTC offset.
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'}).formatToParts(day).find(p=>p.type==='timeZoneName').value;
  const match=/^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  if(!match) fail('timezone_unavailable');
  return new Date(`${target}T17:00:00${match[1]}${match[2]}:${match[3]}`).toISOString();
}
export function transition(current,event,actor,now) {
  if(!actor?.authenticated) fail('authentication_required');
  if(actor.kind==='customer'&&actor.userId!==current.userId) fail('not_found');
  const next={...current};
  switch(event.type) {
    case 'withdraw':
      if(actor.kind!=='customer'||current.contract!=='submitted') fail('invalid_transition');
      next.contract='withdrawn'; break;
    case 'reject':
      if(actor.kind!=='admin'||!actor.strongAuth||current.contract!=='submitted') fail('invalid_transition');
      next.contract='rejected'; next.refundReview=current.payment==='verified'; break;
    case 'accept':
      if(actor.kind!=='admin'||!actor.strongAuth||current.contract!=='submitted') fail('invalid_transition');
      if(time(current.offerExpiresAt)<=time(now)) fail('offer_expired');
      if(!event.noticeId || event.bundleHash!==current.bundleHash) fail('acceptance_record_required');
      if(current.paymentMethod==='wire'&&wireDeadline(now,event.calendar)!==current.wireDueAt) fail('deadline_changed_reconsent');
      next.contract='accepted'; next.companyAcceptedAt=now; next.noticeId=event.noticeId; break;
    case 'payment_verified':
      if(actor.kind!=='payment_adapter'||!actor.verifiedEvidence||!event.providerEventId) fail('trusted_payment_required');
      if(event.currency!=='usd'||event.amountCents!==current.totalCents) fail('payment_mismatch');
      if(['cancelled','rejected','withdrawn','expired'].includes(current.contract)) { next.refundReview=true; break; }
      next.payment='verified'; break;
    case 'refund':
      if(actor.kind!=='payment_adapter'||!actor.verifiedEvidence||!event.providerEventId) fail('trusted_payment_required');
      if(event.currency!=='usd'||!Number.isSafeInteger(event.amountCents)||event.amountCents<=0||event.amountCents>current.totalCents) fail('refund_mismatch');
      next.refundedCents=event.amountCents; // authenticated cumulative processor amount, not a delta
      if(event.amountCents<(current.refundedCents||0)) fail('refund_regression');
      next.payment=event.amountCents===current.totalCents?'refunded':'partially_refunded'; break;
    case 'ship':
      if(actor.kind!=='admin'||!actor.strongAuth||current.contract!=='accepted'||current.payment!=='verified'||current.riskHold||!event.tracking) fail('fulfillment_blocked');
      next.fulfillment='shipped'; next.tracking=event.tracking; break;
    case 'deliver':
      if(actor.kind!=='admin'||!actor.strongAuth||current.fulfillment!=='shipped') fail('invalid_transition');
      next.fulfillment='delivered'; break;
    case 'cancel':
      if(actor.kind!=='admin'||!actor.strongAuth||current.contract!=='accepted'||current.fulfillment!=='unshipped'||!event.legalBasis||!event.reviewReference) fail('lawful_cancellation_review_required');
      next.contract='cancelled'; next.refundReview=current.payment==='verified'; break;
    default: fail('unsupported_event');
  }
  return Object.freeze(next);
}
export function visibleStatus(order) {
  if(order.payment==='refunded') return 'Refunded';
  if(order.payment==='partially_refunded') return 'Partially refunded';
  if(order.refundReview) return 'Payment reconciliation required';
  return `${order.contract} / ${order.payment} / ${order.fulfillment}`;
}
export function disclosureReleaseGate(approvals) {
  for(const field of ['attorneyApproved','ownerApproved','entityVerified','taxApproved','insuranceVerified','processorApproved','sandboxPassed']) if(approvals?.[field]!==true) fail(`release_blocked:${field}`);
  return true;
}
