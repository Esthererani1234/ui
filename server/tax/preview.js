import {assess} from './engine.js';
// Fixed sample assumptions for the read-only Vercel preview.
export function previewExample(state,amount){
  const day='2026-11-26',base={state,version:'preview-example',approval:'approved',source:state==='NY'?'https://www.nysenate.gov/legislation/laws/TAX/1115':'https://dor.wa.gov/wa-sales-tax-rate-lookup-url-interface',valid_from:day,valid_until:day,verified_on:day};
  if(!['NY','WA'].includes(state)||!Number.isSafeInteger(amount)||amount<1||amount>10000000)return {status:'invalid',message:'Choose an amount up to $100,000.'};
  try{
    const wa=state==='WA';
    const result=assess({day,state,subtotal:amount,fee:0,shipping:0,investment:true,policy:{...base,registration:'Example',collection:'collect',first_eligible_cent:wa?0:100001,store_minimum:true,shipping_base:'excluded',fee_base:'excluded',rounding:'combined'},address:{...base,rates:wa?[{level:'state',code:'WA',ppm:65000},{level:'combined_local',code:'3406 example',ppm:19000}]:[]},lines:[{id:1,quantity:1,gross:amount,classification:{...base,treatment:wa?'taxable':'eligible',form:'bar',metal:'gold',market_unit_cents:amount,market_source:base.source,market_day:day}}]});
    return {status:result.status,total:result.total,tax:result.tax};
  }catch(e){return {status:'blocked',message:e.message,remaining:e.remaining_cents};}
}
