import {transactionEligibility} from './transactionConditions.js';
import {minimumMessage, storeFloor} from '../../shared/bullionMinimums.js';

// All inputs to this module come from a locked quote and reviewed server records.
export class TaxReview extends Error {
  constructor(message) { super(message); this.status = 409; }
}
class MissingSaleEvidence extends TaxReview {}
const missingEvidence=message=>{throw new MissingSaleEvidence(message);};
const review = message => { throw new TaxReview(message); };
function integer(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) review('A tax calculation input needs review.');
  return value;
}
export function cents(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) review('A quoted amount could not be verified.');
  return integer(Number(BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2,'0'))));
}
const roundRatio = (a,b,d) => integer(Number((BigInt(a)*BigInt(b)*2n+BigInt(d))/(BigInt(d)*2n)));
export function allocate(total, weights) {
  integer(total); weights.forEach(n=>integer(n));
  const sum = weights.reduce((a,b)=>integer(a+b),0);
  if (!sum) { if (total) review('A charge cannot be allocated.'); return weights.map(()=>0); }
  const numerators = weights.map(w=>BigInt(w)*BigInt(total));
  const allocated = numerators.map(n=>Number(n/BigInt(sum)));
  const order = numerators.map((n,i)=>({i,remainder:n%BigInt(sum)}))
    .sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
  const left = total-allocated.reduce((a,b)=>a+b,0);
  for (const {i} of order.slice(0,left)) allocated[i]++;
  return allocated;
}
export function current(record, day) {
  return Boolean(record?.approval==='approved' && record.source?.startsWith('https://') &&
    record.valid_from && record.valid_from<=day && record.valid_until>=day &&
    record.verified_on && record.verified_on<=day && record.version);
}
// A total rate already contains all components; a combined local rate contains every local component.
export function validateRateComponents(rates) {
  const levels=['state','county','city','district','combined_local','combined'];
  if(!Array.isArray(rates) || !rates.length) review('The local rate is unavailable.');
  const codes=new Set();
  for(const r of rates){
    if(!r || !levels.includes(r.level) || typeof r.code!=='string' || !r.code.trim() ||
       codes.has(r.code.trim().toUpperCase()) || integer(r.ppm)>1000000) review('A jurisdiction rate is invalid or duplicated.');
    codes.add(r.code.trim().toUpperCase());
  }
  const local=rates.filter(r=>r.level!=='state');
  if((rates.some(r=>r.level==='combined') && rates.length>1) ||
     (local.some(r=>r.level==='combined_local') && local.length>1) ||
     rates.filter(r=>r.level==='state').length>1) review('The jurisdiction rates overlap.');
}
function alaskaTaxParts(address,lines,net,eligible,meetsExemption,shippingBase,feeBase) {
  if(address.cap_basis!=='arsstc_monthly_retail' || shippingBase || feeBase)
    review('Alaska tax caps and the allocation of ancillary charges need verification.');
  const cap=(term)=>{
    if(!term || !Object.hasOwn(term,'limit_cents') || !/^https?:\/\/\S+$/.test(term.source))review('The local Alaska tax cap needs verification.');
    return term.limit_cents===null?null:integer(term.limit_cents);
  };
  return address.rates.map(rate=>{
    const itemCap=cap(rate.caps?.per_item),transactionCap=cap(rate.caps?.per_transaction);
    const beforeTransaction=lines.reduce((sum,line,i)=>{
      if(eligible[i] && meetsExemption)return sum;
      let lineBase=net[i];
      if(itemCap!==null){
        const capForQuantity=BigInt(itemCap)*BigInt(line.quantity);
        if(capForQuantity<BigInt(lineBase))lineBase=Number(capForQuantity);
      }
      return integer(sum+lineBase);
    },0);
    const amount=transactionCap===null?beforeTransaction:Math.min(beforeTransaction,transactionCap);
    return {code:rate.code,level:rate.level,ppm:rate.ppm,base_cents:amount,cents:roundRatio(amount,rate.ppm,1000000),caps:rate.caps};
  });
}
function faceInUsd(rule,day) {
  const face=integer(rule.denomination_cents,1);
  if(rule.denomination_currency==='USD')return face;
  if(rule.denomination_currency!=='CAD' || rule.face_fx_observed_on!==day || !rule.face_fx_source?.startsWith('https://'))
    review('A dated conversion for the coin denomination is required.');
  return integer(rule.face_usd_cents,1);
}
function faceRatioInUsd(rule,day){
  if(rule.denomination_currency==='USD')return [BigInt(integer(rule.denomination_cents,1)),1n];
  faceInUsd(rule,day);
  return [BigInt(integer(rule.denomination_cents,1))*10000n,BigInt(integer(rule.cad_per_usd_10000,1))];
}
function fairMarketAboveFace(rule,day) {
  const observation=rule.coin_valuation;
  if(observation?.day!==day || !observation.source?.startsWith('https://') ||
      !['USD',rule.denomination_currency].includes(observation.currency))
    review('A dated fair market value for this coin is required.');
  const market=BigInt(integer(observation.unit_cents,1));
  if(observation.currency===rule.denomination_currency)return market>BigInt(integer(rule.denomination_cents,1));
  const [numerator,denominator]=faceRatioInUsd(rule,day);
  return market*denominator>numerator;
}
// Only the foreign coins sold away from face value participate in the Florida
// group for this catalog. US legal tender and exempt bars never count toward it.
function floridaCoinEligibility(lines,net,day) {
  const grouped=lines.map((line,i)=>{
    const rule=line.classification;
    if(rule?.value_test!=='fl_foreign_coin_group')return false;
    if(!current(rule,day) || rule.form!=='coin' || rule.issuing_country!=='CA')review('The Florida coin classification needs review.');
    // A discounted quantity split across two cent prices needs per-unit evidence.
    if(net[i]%line.quantity)review('The individual foreign coin selling prices need verification.');
    return net[i]/line.quantity!==faceInUsd(rule,day);
  });
  const total=net.reduce((sum,value,i)=>grouped[i]?integer(sum+value):sum,0);
  return grouped.map(member=>!member || total>50000);
}
function eligibility(line, net, state, day, investment) {
  const p=line.classification;
  if (!current(p,day) || !['eligible','taxable'].includes(p.treatment)) review('A product tax classification needs review.');
  if (p.treatment==='taxable') return false;
  const transaction=transactionEligibility(p,line,net,state,day,review,missingEvidence);
  if(transaction!==undefined)return transaction;
  if(p.value_test==='nv_coin_face_premium'){
    const [face,denominator]=faceRatioInUsd(p,day);
    const unitFloor=Math.floor(net/line.quantity),unitCeiling=Math.ceil(net/line.quantity);
    if(BigInt(unitFloor)*denominator*2n<=face*3n && BigInt(unitCeiling)*denominator*2n>face*3n)
      review('The individual Nevada coin sale prices need verification.');
    return BigInt(net)*denominator*2n<=BigInt(line.quantity)*face*3n;
  }
  if(p.value_test==='la_online_numismatic'){
    if(net%line.quantity && Math.floor(net/line.quantity)===100000)review('The individual Louisiana coin sale prices need verification.');
    return BigInt(net)<=100000n*BigInt(line.quantity);
  }
  if (p.value_test==='fair_market_above_face')return fairMarketAboveFace(p,day);
  if(state==='NY') {
    if (!investment) return false;
    if (!['bar','ingot','coin'].includes(p.form) || !['gold','silver','platinum','palladium','rhodium','ruthenium','iridium'].includes(p.metal)) review('The New York product classification needs review.');
    if (p.market_day!==day || !p.market_source?.startsWith('https://') || !p.market_unit_cents ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.prior_business_day) || p.prior_business_day>=day ||
        p.market_observed_on!==p.prior_business_day || !p.market_calendar_source?.startsWith('https://') ||
        !['cash_close','bid_ask_average'].includes(p.market_basis)) review('The required bullion market value is awaiting verification.');
    let basis=integer(p.market_unit_cents,1), cap=115;
    if(p.form==='coin') {
      // The statute uses the greater of face and metal value. A missing CAD rate
      // cannot change an exemption already established from the metal value alone.
      if (p.face_currency!=='CAD' || p.face_usd_cents!=null) basis=Math.max(basis,integer(p.face_usd_cents));
      if(p.metal==='silver') cap=140;
      if(p.metal==='gold' && integer(p.gross_micro_oz,1)<=250000) cap=120;
    }
    const numerator=integer(p.fine_oz_numerator ?? 1,1), denominator=integer(p.fine_oz_denominator ?? 1,1);
    if ((p.fine_oz_numerator==null)!==(p.fine_oz_denominator==null) || (p.form==='coin' && numerator!==denominator))
      review('The fine metal weight needs review.');
    const receipt=BigInt(net)*100n*BigInt(denominator);
    const limitPerUnit=BigInt(line.quantity)*BigInt(basis)*BigInt(cap);
    if(receipt<=limitPerUnit*BigInt(numerator))return true;
    if(p.form==='coin' && p.face_currency==='CAD' && p.face_usd_cents==null)
      review('The current exchange rate for the face value needs verification.');
    if(p.fine_oz_max_numerator!=null && receipt<=limitPerUnit*BigInt(integer(p.fine_oz_max_numerator,numerator)))
      review('The exact fine weight of the bar is required at this price.');
    return false;
  }
  if(state==='NJ' && p.form==='coin') {
    if(p.market_day!==day || !p.market_source) review('The fair market value of the individual coin needs review.');
    return integer(p.market_unit_cents)>=100000;
  }
  return true;
}
export function assess({day,state,policy,address,lines,subtotal,shipping,fee,investment=false},{historicalReport=false}={}) {
  const floor = storeFloor(state, day);
  const requireMinimum = (amount, limit) => {
    if (historicalReport || amount >= limit) return;
    const error = new TaxReview(minimumMessage(state, limit));
    error.code = 'ORDER_MINIMUM';
    error.remaining_cents = limit - amount;
    throw error;
  };
  if (!policy?.shipping_disabled) requireMinimum(integer(subtotal), floor);
  if(!policy || policy.shipping_disabled) review(policy?.shipping_disabled?'Orders to this jurisdiction are disabled.':'This jurisdiction needs tax review.');
  if(!current(policy,day) || policy.state!==state) review('Tax treatment for this address is awaiting verification.');
  const merchandiseOnly=policy.collection==='exempt_merchandise';
  if(merchandiseOnly && (!['WY','VA'].includes(state) || policy.collection_basis!=='reviewed_exempt_items'))
    review('The merchandise exemption policy needs review.');
  if(!['collect','no_obligation','exempt_merchandise'].includes(policy.collection)) review('The collection obligation for this jurisdiction needs review.');
  if(!current(address,day) || address.state!==state) review('Tax treatment for this address is awaiting verification.');
  if(state==='NY' && policy.collection!=='collect') review('New York registration and collection must be reviewed.');
  if(!lines.length) review('A cart is required.');
  [subtotal,shipping,fee].forEach(n=>integer(n));
  const gross=lines.map(l=>{integer(l.quantity,1);return integer(l.gross,1);});
  if(subtotal>gross.reduce((a,b)=>a+b,0)) review('The quote discount could not be verified.');
  const net=allocate(subtotal,gross);
  const remoteOnly=['zero_prior_calendar_year','below_remote_threshold'].includes(policy.remote_basis);
  if (remoteOnly && policy.collection!=='no_obligation')
    review('An active registration requires reviewed collection and fee rules.');
  const florida=state==='FL'?floridaCoinEligibility(lines,net,day):null;
  const evidenceNeeded=new Map();
  const qualified=lines.map((line,i)=>{
    if (remoteOnly && !current(line.classification,day)) return null;
    try {
      return (!florida || florida[i]) && eligibility(line,net[i],state,day,investment);
    }catch(error){
      if(!remoteOnly || policy.collection!=='no_obligation' || !(error instanceof MissingSaleEvidence))throw error;
      evidenceNeeded.set(i,error.message);
      return null;
    }
  });
  const qualifiedSum=net.reduce((sum,n,i)=>sum+(qualified[i]?n:0),0);
  // Store minimum and statutory eligibility are separate. Exclusive thresholds
  // are represented by the first qualifying cent (NY $1,000.01).
  const minimum=integer(policy.first_eligible_cent);
  if (qualified.some(Boolean)) requireMinimum(qualifiedSum, Math.max(floor, policy.store_minimum ? minimum : 0));
  let meetsExemption = qualifiedSum >= minimum;
  if(state==='CA' && qualifiedSum>0){
    if(minimum!==200000 || day<'2026-11-26' || day>'2026-12-31')review('The dated California bulk threshold needs verification.');
    if(!meetsExemption && qualifiedSum+shipping+fee>=minimum)review('California sales-price treatment of the additional charges needs review.');
    if(meetsExemption){
      if(policy.ca_commodity_registration==='required_unregistered')meetsExemption=false;
      else if(!['registered','registration_not_required'].includes(policy.ca_commodity_registration))
        review('California bullion seller eligibility needs review.');
    }
  }
  if(state==='NY' && meetsExemption && qualifiedSum>0){
    if(policy.ny_dealer_status==='required_unregistered') meetsExemption=false;
    else if(!['registered','registration_not_required'].includes(policy.ny_dealer_status))
      review('New York bullion dealer eligibility needs review.');
  }
  const unclassified=net.reduce((sum,n,i)=>sum+(qualified[i]===null?n:0),0);
  const taxable=net.reduce((sum,n,i)=>sum+(qualified[i]!==null && (!qualified[i] || !meetsExemption)?n:0),0);
  if(merchandiseOnly && (taxable || unclassified || qualifiedSum!==subtotal || !meetsExemption || fee || shipping))
    review('The tax treatment of this item or additional charge needs review.');
  const chargeBase=(amount,mode)=>{
    if(!amount || !taxable)return 0;
    if(mode==='full_if_taxable')return amount;
    if(mode==='proportional')return roundRatio(amount,taxable,subtotal);
    if(mode==='excluded')return 0;
    return review('The treatment of a shipping or payment charge needs review.');
  };
  const collect=policy.collection==='collect';
  // Product taxability remains recorded even if the seller owes no collection.
  // Leave the potential tax base open when ancillary charges have not been classified.
  const base=remoteOnly && (unclassified || (taxable && (shipping || fee))) ? null
    : integer(taxable+chargeBase(shipping,policy.shipping_base)+chargeBase(fee,policy.fee_base));
  const levyKind = {HI:'general_excise',NM:'gross_receipts'}[state];
  const passThrough = policy.seller_levy_treatment;
  if (levyKind && collect && !['absorb','pass_through'].includes(passThrough)) review('The seller tax treatment needs review.');
  let breakdown=[], tax=0, destinationLevy=null;
  if(collect && base) {
    if(!Array.isArray(address.rates) || !address.rates.length || !['combined','component'].includes(policy.rounding)) review('The local rate or rounding rule is unavailable.');
    validateRateComponents(address.rates);
    const rates=address.rates.map(r=>r.ppm);
    const combined=rates.reduce((a,b)=>a+b,0);
    if(state==='AK' && historicalReport){
      if(policy.rounding!=='component')review('The rounding treatment for each Alaska local tax needs verification.');
      breakdown=alaskaTaxParts(address,lines,net,qualified,meetsExemption,chargeBase(shipping,policy.shipping_base),chargeBase(fee,policy.fee_base));
      tax=breakdown.reduce((sum,row)=>integer(sum+row.cents),0);
    }else if (levyKind) {
      if (policy.seller_taxes?.some(item=>item.kind===levyKind)) review('The seller levy was configured twice.');
      if (!combined || combined>=1000000) review('The seller tax rate needs review.');
      const amount = state==='HI' && passThrough==='pass_through'
        ? roundRatio(base, integer(address.max_pass_on_ppm,1), 1000000)
        : roundRatio(base, combined, 1000000);
      if (state==='HI' && passThrough==='pass_through' && BigInt(address.max_pass_on_ppm)*BigInt(1000000-combined)>BigInt(combined)*1000000n)
        review('The reviewed pass-on exceeds the permitted rate.');
      const passed = passThrough==='pass_through' ? amount : 0;
      const measure = base + (state==='HI' ? passed : 0);
      destinationLevy = {kind:levyKind, code:address.rates.map(r=>r.code).join('/'), base:measure,
        ppm:combined, cents:roundRatio(measure,combined,1000000), customer_funded_cents:passed};
      const parts=allocate(passed,rates);
      breakdown=address.rates.map((r,i)=>({code:r.code,level:r.level,kind:levyKind,ppm:r.ppm,cents:parts[i]}));
      tax=passed;
    } else {
      const parts=policy.rounding==='combined'?allocate(roundRatio(base,combined,1000000),rates):rates.map(r=>roundRatio(base,r,1000000));
      breakdown=address.rates.map((r,i)=>({code:r.code,level:r.level,ppm:r.ppm,cents:parts[i]}));
      tax=parts.reduce((a,b)=>a+b,0);
    }
  }
  const sellerTaxes=(policy.seller_taxes || []).map(levy=>{
    if(!['gross_receipts','general_excise','business_occupation'].includes(levy.kind) || !['merchandise','receipts_before_sales_tax','taxable_merchandise'].includes(levy.base) || !levy.code || integer(levy.ppm)>1000000)review('Seller tax treatment requires review.');
    const measure=levy.base==='merchandise'?subtotal:levy.base==='taxable_merchandise'?taxable:integer(subtotal+shipping+fee);
    return {kind:levy.kind,code:levy.code,base:measure,ppm:levy.ppm,cents:roundRatio(measure,levy.ppm,1000000)};
  });
  for (let i=0;i<breakdown.length;i++) {
    const {name,county,districts,reporting_code,included_rates}=address.rates[i];
    Object.assign(breakdown[i],{name,county,districts,reporting_code,included_rates});
  }
  if (destinationLevy) sellerTaxes.push(destinationLevy);
  const jurisdictions = (address.rates || []).map(({level,code,name,county,districts,reporting_code})=>({level,code,name,county,districts,reporting_code}));
  return {jurisdictions,related_receipts_version:policy.related_receipts_version,related_receipts_document:policy.related_receipts_document,remote_basis:policy.remote_basis,receipts_upper_bound_cents:policy.receipts_upper_bound_cents,
    transactions_upper_bound:policy.transactions_upper_bound,geography:address.geography,rate_source:address.source,rate_verified_on:address.verified_on,rate_effective_from:address.valid_from,rate_valid_until:address.valid_until,policy_source:policy.source,seller_taxes:sellerTaxes,state,day,collection:policy.collection,status:merchandiseOnly?'exempt':collect?(base?'taxable':'exempt'):'not_collected',subtotal,shipping,fee,tax,total:integer(subtotal+shipping+fee+tax),taxable,exempt:subtotal-taxable-unclassified,unclassified,base,breakdown,policy_version:policy.version,address_version:address.version,registration:policy.registration,lines:lines.map((l,i)=>({id:l.id,net:net[i],exempt:qualified[i]&&meetsExemption,version:l.classification?.version ?? null,
      ...(evidenceNeeded.has(i)?{evidence_needed:evidenceNeeded.get(i)}:{}),...(l.sale_evidence?{sale_evidence:l.sale_evidence}:{}),
      ...(l.metal_priced===true && l.classification?.value_test?{locked_metal_price:true}:{}),
      ...(l.classification?.value_test?{value_test:l.classification.value_test,coin_valuation:l.classification.coin_valuation,
        denomination_cents:l.classification.denomination_cents,denomination_currency:l.classification.denomination_currency,
        face_usd_cents:l.classification.face_usd_cents,cad_per_usd_10000:l.classification.cad_per_usd_10000,face_fx_source:l.classification.face_fx_source,face_fx_observed_on:l.classification.face_fx_observed_on}:{}),...(state==='NY' && qualified[i] ? {market_day:l.classification.market_observed_on,market_basis:l.classification.market_basis,market_source:l.classification.market_source,market_unit_cents:l.classification.market_unit_cents,market_calendar_source:l.classification.market_calendar_source,fine_oz_numerator:l.classification.fine_oz_numerator,fine_oz_max_numerator:l.classification.fine_oz_max_numerator,fine_oz_denominator:l.classification.fine_oz_denominator,face_usd_cents:l.classification.face_usd_cents,face_fx_source:l.classification.face_fx_source} : {})}))};
}
export const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
