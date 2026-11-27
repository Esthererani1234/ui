import {alaskaReportAddress,resolveRegionalEvidence} from './regionalEvidence.js';
import {completeOrderMarketInputs} from './bullionMarket.js';
import {streetRateResolvers} from './streetRates.js';
import {confirmDestination} from './destinationRates.js';
import {businessDay} from '../../shared/bullionMinimums.js';
import {assess,cents,current,TaxReview} from './engine.js';

function reviewed(result) {
  if (!Number.isSafeInteger(result.tax) || result.tax<0) throw new TaxReview('The tax amount needs verification.');
  return {day:result.day,state:result.state,tax:result.tax,taxable:result.taxable,exempt:result.exempt,
    unclassified:result.unclassified,collection:result.collection,breakdown:result.breakdown || [],
    related_receipts_version:result.related_receipts_version,related_receipts_document:result.related_receipts_document,
    receipts_upper_bound_cents:result.receipts_upper_bound_cents,transactions_upper_bound:result.transactions_upper_bound,geography:result.geography, jurisdictions:result.jurisdictions,policy_source:result.policy_source,policy_version:result.policy_version,
    rate_source:result.rate_source,address_version:result.address_version,lines:result.lines,seller_taxes:result.seller_taxes};
}

export async function calculateAdminOrder(input,{localEvidence=resolveRegionalEvidence}={}) {
  if(input.report)return input.report;
  if(input.review){
    const result={status:'review',reason:input.review,day:input.day};
    if(input.state_scope)result.state_scope=input.state_scope;
    if(input.regional_destination && input.day===businessDay()){
      const evidence=await localEvidence(input.regional_destination,input.day).catch(()=>null);
      if(evidence)result.local_evidence=evidence;
    }
    return result;
  }
  try {
    if(input.saved)return {status:'recorded',...reviewed(input.saved)};
    const {day,state,policy}=input;
    let district=input.district;
    if (!district && day===businessDay()) {
      const a=input.destination;
      if (a?.state!==state || a.country!=='US' || !a.address_line_1 || !a.city || !/^\d{5}(?:-\d{4})?$/.test(a.postal_code))
        throw new TaxReview('The original street address needs verification.');
      const lookup=(state==='AK' && policy.collection==='collect'?alaskaReportAddress:streetRateResolvers[state]) || (['no_obligation','exempt_merchandise'].includes(policy.collection)?confirmDestination:null);
      if(lookup){
        try{district=await lookup(a,day);}
        catch{return {status:'review',day,reason:'The street jurisdiction or rate could not be verified.',retryable:true};}
      }
    }
    if(!current(district,day))throw new TaxReview('A verified street jurisdiction and rates for the original order date are needed.');
    if(input.insurance!=null && cents(input.insurance)>0)throw new TaxReview('The separate insurance charge needs review.');
    const products=await completeOrderMarketInputs(state,input.products,day,input.investment);
    const lines=input.lines.map(item=>{
      const rule=products?.[item.id];
      if(!current(rule,day) || !item.sku || !item.name || !item.metal || item.weight==null ||
        rule.catalog_sku!==item.sku || rule.catalog_name!==item.name || rule.metal!==item.metal || Number(rule.catalog_weight)!==Number(item.weight))
        throw new TaxReview('An order item needs a verified historical product classification.');
      return {id:item.id,quantity:item.quantity,gross:cents(item.gross),classification:rule,metal_priced:item.metal_priced,
        special_terms:item.special_terms,sale_evidence:item.sale_evidence};
    });
    const terms={day,state,policy,address:district,lines,subtotal:cents(input.subtotal),
      shipping:cents(input.shipping),fee:cents(input.fee)};
    if(state==='NY' && input.investment!==true && input.investment!==false && terms.subtotal>=100001)
      throw new TaxReview('Investment-purchase evidence for the original order needs review.');
    const result=assess({...terms,investment:input.investment===true},{historicalReport:true});
    return {status:'calculated',...reviewed(result)};
  } catch(error) {
    if(!(error instanceof TaxReview))throw error;
    return {status:'review',day:input.day,reason:error.message};
  }
}
