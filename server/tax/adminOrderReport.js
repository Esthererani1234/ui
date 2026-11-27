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

export async function calculateAdminOrder(input,{localEvidence=resolveRegionalEvidence,today=businessDay()}={}) {
  if(input.report)return input.report;
  if(input.review){
    const result={status:'review',reason:input.review,day:input.day};
    if(input.state_scope)result.state_scope=input.state_scope;
    if(input.ak_specie)result.ak_specie=input.ak_specie;
    if(input.regional_destination && input.day===today){
      const evidence=await localEvidence(input.regional_destination,input.day,{municipalRules:input.co_city_rules,gallatinRule:input.mt_gallatin_rule}).catch(()=>null);
      if(evidence && !(evidence.state==='AK' && evidence.scope==='no_general_retail_tax' && Object.hasOwn(input,'anchorage_policy') &&
        !current(input.anchorage_policy,input.day))){
        result.local_evidence=evidence;
        const member=input.member_policy;
        if(evidence.day===input.day && input.regional_destination.state==='AK' && evidence.state==='AK' && evidence.scope==='member_general_rates' && member?.scope==='arsstc_member' &&
          member.state==='AK' && member.collection==='no_obligation' && current(member,input.day)){
          result.member_threshold={source:member.source,version:member.version,receipts_upper_bound_cents:member.receipts_upper_bound_cents};
        }
      }
    }
    return result;
  }
  try {
    if(input.saved)return {status:'recorded',...reviewed(input.saved)};
    const {day,state,policy}=input;
    const alaskaMetal=state==='AK' && Object.hasOwn(input,'anchorage_policy') && policy?.collection==='collect' &&
      input.lines?.some(item=>['gold','silver'].includes(item.metal));
    let district=input.district;
    if (!district && day===today) {
      const a=input.destination;
      if (a?.state!==state || a.country!=='US' || !a.address_line_1 || !a.city || !/^\d{5}(?:-\d{4})?$/.test(a.postal_code))
        throw new TaxReview('The original street address needs verification.');
      const lookup=(alaskaMetal?confirmDestination:state==='AK' && policy.collection==='collect'?alaskaReportAddress:streetRateResolvers[state]) || (['no_obligation','exempt_merchandise'].includes(policy.collection)?confirmDestination:null);
      if(lookup){
        try{district=await lookup(a,day);}
        catch{return {status:'review',day,reason:'The street jurisdiction or rate could not be verified.',retryable:true};}
      }
    }
    if(!current(district,day))throw new TaxReview('A verified street jurisdiction and rates for the original order date are needed.');
    if(alaskaMetal){
      const local=input.anchorage_policy, facts=input.ak_specie;
      const inAnchorage=current(local,day) && local.state==='AK' && local.scope==='no_general_retail_tax' &&
        local.county_geoid==='02020' && district.state===state && district.geography?.state?.geoid==='02' &&
        district.geography?.county?.geoid===local.county_geoid;
      if(!inAnchorage || !current(policy,day) || policy.state!==state || policy.shipping_disabled ||
        !Number.isSafeInteger(facts?.metal_price_cents) || facts.metal_price_cents<=0 ||
        !Number.isSafeInteger(facts.markup_cents) || facts.markup_cents<0 ||
        facts.metal_price_cents+facts.markup_cents!==cents(input.subtotal) ||
        cents(input.shipping)!==0 || cents(input.fee)!==0 || cents(input.insurance??0)!==0)
        return {status:'review',day,reason:'Verify the local treatment of the bullion sale, dealer premium and any fees.',ak_specie:facts};
      const locality=district.geography.county;
      return {status:'calculated',day,state,tax:0,taxable:0,exempt:cents(input.subtotal),unclassified:0,
        collection:policy.collection,breakdown:[],seller_taxes:[],geography:district.geography,address_version:district.version,
        jurisdictions:[{level:'county',code:locality.geoid,name:locality.name}],rate_source:local.source,
        policy_source:policy.source,policy_version:policy.version,local_policy_version:local.version,ak_specie:facts,lines:facts.lines};
    }
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
