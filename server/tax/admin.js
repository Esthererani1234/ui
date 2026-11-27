import states from '../../shared/taxSources.json' with {type:'json'};
import {normalizeAddress} from './quote.js';
import {TaxReview,validateRateComponents} from './engine.js';
const codes=new Set(states.map(s=>s.code));
export const dayNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const check=(ok,msg)=>{if(!ok)throw new TaxReview(msg);};
export function date(s){
  check(typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Enter a valid date.');return s;
}
export function jurisdiction(s){check(codes.has(s),'Select a US state or DC.');return s;}
export async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw new TaxReview('The database could not verify this operation. Check the inputs and existing records.');return data;}
export function validateVersion(state,v){
  const {kind,subject,source,approval,data}=v;const row=states.find(r=>r.code===state);
  check(row.sources.some(s=>s.url===source),'Select an official source listed for this jurisdiction.');
  check(approval==='requires_review'||approval==='approved','Select an approval status.');
  check(data&&typeof data==='object'&&!Array.isArray(data),'Enter structured rule fields.');
  date(v.start);date(v.end);date(v.verified);
  check(v.end>=v.start&&v.verified<=dayNow(),'Check the validity and verification dates.');
  const num=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
  if(kind==='policy'){
    check(subject==='state'&&num(data.first_eligible_cent)&&typeof data.store_minimum==='boolean'&&
      ['combined','component'].includes(data.rounding)&&['full_if_taxable','proportional','excluded'].includes(data.shipping_base)&&
      ['full_if_taxable','proportional','excluded'].includes(data.fee_base),'Check the threshold, rounding and charge treatments.');
    if (state==='CA' && data.ca_commodity_registration!=null)
      check(['registered','registration_not_required','required_unregistered'].includes(data.ca_commodity_registration),'Check Commodity Exchange Act registration eligibility.');
    if(state==='NY' && data.ny_dealer_status!=null)
      check(['registered','registration_not_required','required_unregistered'].includes(data.ny_dealer_status),'Check the bullion dealer registration status.');
    if (['HI','NM'].includes(state)) check(['absorb','pass_through'].includes(data.seller_levy_treatment),'Choose whether the business absorbs or passes on the reviewed destination levy.');
    check(data.uniform_jurisdiction_base===true && data.separate_seller_tax_reviewed===true,'Confirm the local tax bases and seller taxes are supported. Keep complex treatments in review.');
  }else if(kind==='product'){
    check(/^\d+$/.test(subject)&&['eligible','taxable'].includes(data.treatment)&&['bar','coin','ingot','round','jewelry','collectible','other'].includes(data.form),'Enter the product ID, form and local eligibility.');
  }else if(kind==='address'){
    const addr=normalizeAddress(JSON.parse(subject));check(addr.state===state,'The address must match the selected state.');
    validateRateComponents(data.rates);
    check(new Set(data.rates.map(r=>r.code)).size===data.rates.length &&
      data.rates.every(r=>(r.name==null || typeof r.name==='string') && (r.county==null || typeof r.county==='string') &&
      (r.districts==null || (Array.isArray(r.districts) && r.districts.every(d=>typeof d==='string')))),
      'Enter unique jurisdiction codes and valid names for the county and taxing districts.');
  }else if(kind==='nexus'){
    check(subject==='state'&&['current_or_prior_calendar','rolling_12_months','ny_four_completed_quarters'].includes(data.period)&&['gross','taxable'].includes(data.base)&&['and','or'].includes(data.operator)&&
      (num(data.revenue_trigger_cents,1)||num(data.transaction_trigger,1))&&typeof data.deduct_refunds==='boolean'&&typeof data.include_marketplace==='boolean','Check the nexus window, included sales, first triggering cent or transaction, and threshold operator.');
  }else check(false,'Invalid review category.');
}
export function ledgerCsv(rows){
  const columns=['event_key','order_id','state','booked','kind','channel','merchandise','taxable','exempt','unclassified','tax','breakdown','seller_taxes','confirmation'];
  const cell=v=>{let t=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(typeof v==='string'&&/^[\s]*[=+@-]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};
  return [columns.join(','),...rows.map(r=>columns.map(c=>cell(c==='unclassified' && r.taxable!=null && r.exempt!=null ? r.merchandise-r.taxable-r.exempt : r[c])).join(','))].join('\r\n');
}
