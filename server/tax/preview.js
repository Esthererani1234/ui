import {correctDeliveryAddress} from '../address/correct.js';
import {streetRateResolvers} from './streetRates.js';
import {washingtonAddress} from './washington.js';
import {hawaiiSource,hawaiiRetail} from './hawaii.js';
import nmSchedule from './newMexicoLocations.json' with {type:'json'};
import quarter from './washingtonQuarter.json' with {type:'json'};
import {assess} from './engine.js';
import {bullionMinimums, storeFloor} from '../../shared/bullionMinimums.js';

// Illustrations use published examples and fixed assumptions, never a live quote.
const exampleDay = '2026-11-26';
const samples = {
  WA: {source:'https://dor.wa.gov/wa-sales-tax-rate-lookup-url-interface'},
  ME: {source:'https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates', rates:[['state','ME',55000]]},
  VT: {source:'https://tax.vermont.gov/business/local-option-tax', rates:[['state','VT',60000],['city','Burlington',10000]]},
  DC: {source:'https://otr.cfo.dc.gov/release/notice-oct-1-2026-tax-changes', rates:[['district','DC',60000]]},
  HI: {source:hawaiiSource, rates:[['state','HI',hawaiiRetail.state],['county','Honolulu',hawaiiRetail.county]], max_pass_on_ppm:hawaiiRetail.maxPassOn},
  NM: {source:'https://www.tax.newmexico.gov/grt-rate-finder-tools/', rates:[['combined','01-123',nmSchedule.locations.find(r=>r.code==='01-123').ppm]]},
};
const references = {
  NY:'https://www.nysenate.gov/legislation/laws/TAX/1115',
  CA:'https://cdtfa.ca.gov/lawguides/vol1/sutr/1599.html',
  CT:'https://portal.ct.gov/drs/miscellaneous-taxes/other-tax-page/state-tax-developments/2025-developments/sut-and-administrative-and-dues-taxes',
  MA:'https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64H/Section6',
  MD:'https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gtg&section=11-214.1',
};
export function previewExample(state, amount, place = 'olympia', verifiedAddress=null, day=exampleDay) {
  if (!(Object.hasOwn(samples,state) || Object.hasOwn(bullionMinimums,state)) ||
      !Number.isSafeInteger(amount) || amount < 1 || amount > 100000000)
    return {status:'invalid', message:'Choose a sample and an amount up to $1,000,000.'};
  let sample = samples[state];
  if (state==='WA' && !verifiedAddress) {
    const code = {olympia:'3403',tumwater:'3406',spokane:'3210',seattle:'1726'}[place];
    if (typeof code!=='string') return {status:'invalid',message:'Choose a Washington sample address.'};
    const [stateRate, localRate] = quarter.rates[code];
    sample = {...sample,rates:[['state','WA',stateRate],['combined_local',code,localRate]]};
  }
  const base = {state,version:'example',approval:'approved',source:sample?.source || references[state],
    valid_from:day,valid_until:day,verified_on:day};
  try {
    const result=assess({day,state,subtotal:amount,shipping:0,fee:0,investment:true,
      policy:{...base,registration:'Sample',ny_dealer_status:'registration_not_required',collection:'collect',first_eligible_cent:storeFloor(state,day),
        store_minimum:true,shipping_base:'excluded',fee_base:'excluded',rounding:'combined',seller_levy_treatment:'pass_through'},
      address:verifiedAddress || {...base,max_pass_on_ppm:sample?.max_pass_on_ppm,rates:(sample?.rates || []).map(([level,code,ppm])=>({level,code,ppm}))},
      lines:[{id:1,quantity:1,gross:amount,classification:{...base,treatment:sample?'taxable':'eligible',
        form:'bar',metal:'gold',market_unit_cents:amount,market_source:base.source,market_day:day}}]});
    return {status:result.status,total:result.total,tax:result.tax};
  } catch(error) { return {status:'blocked',message:error.message,remaining:error.remaining_cents}; }
}

const washingtonSamples = {
  spokane: {address_line_1:'808 W Spokane Falls Blvd',city:'Spokane',state:'WA',postal_code:'99201'},
  seattle: {address_line_1:'600 4th Ave',city:'Seattle',state:'WA',postal_code:'98104'},
  olympia: {address_line_1:'601 4th Ave E', city:'Olympia',state:'WA',postal_code:'98501'},
  tumwater: {address_line_1:'6400 Linderson Way SW',city:'Tumwater',state:'WA',postal_code:'98501'},
};
const sampleLookups = new Map();
export async function previewCheckout(state,amount,place='olympia') {
  if(state!=='WA' || !Object.hasOwn(washingtonSamples,place) || !Number.isSafeInteger(amount) || amount<1 || amount>100000000)
    return previewExample(state,amount,place);
  try {
    let entry=sampleLookups.get(place);
    if(!entry || entry.until<Date.now()) {
      entry={until:Date.now()+300000,rate:washingtonAddress(washingtonSamples[place],exampleDay)};
      sampleLookups.set(place,entry);
    }
    return previewExample(state,amount,place,await entry.rate);
  } catch {
    sampleLookups.delete(place);
    return {status:'unavailable',message:'The Washington address rate could not be verified.'};
  }
}

// Free-entry demonstrations use the same street correction and jurisdiction lookups as checkout.
export async function previewStreetOrder(address, amount, day, {correct=correctDeliveryAddress, resolvers=streetRateResolvers}={}) {
  if (!['WA','HI','VT','NM'].includes(address?.state) || !Number.isSafeInteger(amount) || amount<1 || amount>100000000)
    return {status:'invalid',message:'Enter a supported destination and an amount up to $1,000,000.'};
  const checked=await correct(address,{postal:false});
  if (checked.address && checked.address.state!==address.state) return {status:'needs_input',message:'Check the destination state.'};
  if (checked.status!=='matched') return checked;
  try {
    const verified=await resolvers[address.state](checked.address,day);
    const calculation=previewExample(address.state,amount,null,verified,day);
    const local=verified.rates.find(component=>component.level!=='state');
    return {...calculation,location:[local?.name || checked.address.city,local?.county || verified.rates[0]?.county].filter((v,i,a)=>v && a.indexOf(v)===i).join(' · '),address:checked.address};
  } catch {
    return {status:'unavailable',message:'The tax jurisdiction for this street address could not be verified.'};
  }
}
