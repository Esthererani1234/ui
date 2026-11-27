import {minimumMessage, storeFloor} from '../../shared/bullionMinimums.js';

// All inputs to this module come from a locked quote and reviewed server records.
export class TaxReview extends Error {
  constructor(message) { super(message); this.status = 409; }
}
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
function eligibility(line, net, state, day, investment) {
  const p=line.classification;
  if (!current(p,day) || !['eligible','taxable'].includes(p.treatment)) review('A product tax classification needs review.');
  if (p.treatment==='taxable') return false;
  if(state==='NY') {
    if (!investment) return false;
    if (!['bar','ingot','coin'].includes(p.form) || !['gold','silver','platinum','palladium','rhodium','ruthenium','iridium'].includes(p.metal)) review('The New York product classification needs review.');
    if (p.market_day!==day || !p.market_source?.startsWith('https://') || !p.market_unit_cents ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.prior_business_day) || p.prior_business_day>=day ||
        p.market_observed_on!==p.prior_business_day || !p.market_calendar_source?.startsWith('https://') ||
        !['cash_close','bid_ask_average'].includes(p.market_basis)) review('The required bullion market value is awaiting verification.');
    let basis=integer(p.market_unit_cents,1), cap=115;
    if(p.form==='coin') {
      basis=Math.max(basis,integer(p.face_usd_cents));
      if(p.metal==='silver') cap=140;
      if(p.metal==='gold' && integer(p.gross_micro_oz,1)<=250000) cap=120;
    }
    return BigInt(net)*100n <= BigInt(line.quantity)*BigInt(basis)*BigInt(cap);
  }
  if(state==='NJ' && p.form==='coin') {
    if(p.market_day!==day || !p.market_source) review('The fair market value of the individual coin needs review.');
    return integer(p.market_unit_cents)>=100000;
  }
  return true;
}
export function assess({day,state,policy,address,lines,subtotal,shipping,fee,investment=false}) {
  const floor = storeFloor(state, day);
  const requireMinimum = (amount, limit) => {
    if (amount >= limit) return;
    const error = new TaxReview(minimumMessage(state, limit));
    error.code = 'ORDER_MINIMUM';
    error.remaining_cents = limit - amount;
    throw error;
  };
  if (!policy?.shipping_disabled) requireMinimum(integer(subtotal), floor);
  if(!policy || policy.shipping_disabled) review(policy?.shipping_disabled?'Orders to this jurisdiction are disabled.':'This jurisdiction needs tax review.');
  if(!current(policy,day) || !current(address,day) || address.state!==state || policy.state!==state) review('Tax treatment for this address is awaiting verification.');
  if(!['collect','no_obligation'].includes(policy.collection)) review('The collection obligation for this jurisdiction needs review.');
  if(state==='NY' && policy.collection!=='collect') review('New York registration and collection must be reviewed.');
  if(!lines.length) review('A cart is required.');
  [subtotal,shipping,fee].forEach(n=>integer(n));
  const gross=lines.map(l=>{integer(l.quantity,1);return integer(l.gross,1);});
  if(subtotal>gross.reduce((a,b)=>a+b,0)) review('The quote discount could not be verified.');
  const net=allocate(subtotal,gross);
  const qualified=lines.map((l,i)=>eligibility(l,net[i],state,day,investment));
  const qualifiedSum=net.reduce((sum,n,i)=>sum+(qualified[i]?n:0),0);
  // Store minimum and statutory eligibility are separate. Exclusive thresholds
  // are represented by the first qualifying cent (NY $1,000.01).
  const minimum=integer(policy.first_eligible_cent);
  if (qualified.some(Boolean)) requireMinimum(qualifiedSum, Math.max(floor, policy.store_minimum ? minimum : 0));
  let thresholdValue = qualifiedSum;
  if (state === 'CA' && qualified.some(Boolean)) {
    thresholdValue = lines.reduce((sum, line, index) => {
      if (!qualified[index]) return sum;
      const p = line.classification;
      if (!p.market_source || p.market_day !== day) review('The bullion market value needs review.');
      return integer(sum + integer(p.market_unit_cents, 1) * line.quantity);
    }, 0);
  }
  let meetsExemption = thresholdValue >= minimum;
  if(state==='NY' && meetsExemption && qualifiedSum>0){
    if(policy.ny_dealer_status==='required_unregistered') meetsExemption=false;
    else if(!['registered','registration_not_required'].includes(policy.ny_dealer_status))
      review('New York bullion dealer eligibility needs review.');
  }
  const taxable=net.reduce((sum,n,i)=>sum+(!qualified[i]||!meetsExemption?n:0),0);
  const chargeBase=(amount,mode)=>{
    if(!amount || !taxable)return 0;
    if(mode==='full_if_taxable')return amount;
    if(mode==='proportional')return roundRatio(amount,taxable,subtotal);
    if(mode==='excluded')return 0;
    return review('The treatment of a shipping or payment charge needs review.');
  };
  const base=integer(taxable+chargeBase(shipping,policy.shipping_base)+chargeBase(fee,policy.fee_base));
  const collect=policy.collection==='collect';
  const levyKind = {HI:'general_excise',NM:'gross_receipts'}[state];
  const passThrough = policy.seller_levy_treatment;
  if (levyKind && collect && !['absorb','pass_through'].includes(passThrough)) review('The seller tax treatment needs review.');
  let breakdown=[], tax=0, destinationLevy=null;
  if(collect && base) {
    if(!Array.isArray(address.rates) || !address.rates.length || !['combined','component'].includes(policy.rounding)) review('The local rate or rounding rule is unavailable.');
    validateRateComponents(address.rates);
    const rates=address.rates.map(r=>r.ppm);
    const combined=rates.reduce((a,b)=>a+b,0);
    if (levyKind) {
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
  return {rate_source:address.source,rate_verified_on:address.verified_on,rate_effective_from:address.valid_from,rate_valid_until:address.valid_until,policy_source:policy.source,seller_taxes:sellerTaxes,state,day,collection:policy.collection,status:collect?(base?'taxable':'exempt'):'not_collected',subtotal,shipping,fee,tax,total:integer(subtotal+shipping+fee+tax),taxable,exempt:subtotal-taxable,base,breakdown,policy_version:policy.version,address_version:address.version,registration:policy.registration,lines:lines.map((l,i)=>({id:l.id,net:net[i],exempt:qualified[i]&&meetsExemption,version:l.classification.version,...(state==='NY' && qualified[i] ? {market_day:l.classification.market_observed_on,market_basis:l.classification.market_basis,market_source:l.classification.market_source,market_unit_cents:l.classification.market_unit_cents} : {})}))};
}
export const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
