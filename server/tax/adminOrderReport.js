import {streetRateResolvers} from './streetRates.js';
import {confirmDestination} from './destinationRates.js';
import {businessDay} from '../../shared/bullionMinimums.js';
import {assess,cents,current,TaxReview} from './engine.js';

function reviewed(result) {
  if (!Number.isSafeInteger(result.tax) || result.tax<0) throw new TaxReview('The tax amount needs verification.');
  return {day:result.day,state:result.state,tax:result.tax,taxable:result.taxable,exempt:result.exempt,
    unclassified:result.unclassified,collection:result.collection,breakdown:result.breakdown || [],
    policy_source:result.policy_source,rate_source:result.rate_source};
}

export async function calculateAdminOrder(input) {
  if(input.review)return {status:'review',reason:input.review,day:input.day};
  try {
    if(input.saved)return {status:'recorded',...reviewed(input.saved)};
    const {day,state,products,policy}=input;
    let district=input.district;
    if (!district && day===businessDay()) {
      const a=input.destination;
      if (a?.state!==state || a.country!=='US' || !a.address_line_1 || !a.city || !/^\d{5}(?:-\d{4})?$/.test(a.postal_code))
        throw new TaxReview('The original street address needs verification.');
      const lookup=streetRateResolvers[state] || (policy.collection==='no_obligation'?confirmDestination:null);
      if(lookup)district=await lookup(a,day);
    }
    if(!current(district,day))throw new TaxReview('A verified street jurisdiction and rates for the original order date are needed.');
    if(input.insurance!=null && cents(input.insurance)>0)throw new TaxReview('The separate insurance charge needs review.');
    const lines=input.lines.map(item=>{
      const rule=products?.[item.id];
      if(!current(rule,day) || !item.sku || !item.name || !item.metal || item.weight==null ||
        rule.catalog_sku!==item.sku || rule.catalog_name!==item.name || rule.metal!==item.metal || Number(rule.catalog_weight)!==Number(item.weight))
        throw new TaxReview('An order item needs a verified historical product classification.');
      return {id:item.id,quantity:item.quantity,gross:cents(item.gross),classification:rule};
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
