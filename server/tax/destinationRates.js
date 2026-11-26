import {TaxReview} from './engine.js';

const census = 'https://geocoding.geo.census.gov/geocoder/geographies/address';
const publications = {
  ME: ['23','https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates'],
  DC: ['11','https://otr.cfo.dc.gov/release/notice-oct-1-2026-tax-changes'],
  HI: ['15','https://tax.hawaii.gov/geninfo/countysurcharge/'],
  VT: ['50','https://tax.vermont.gov/business/local-option-tax'],
};
const streetTerms = {STREET:'ST',AVENUE:'AVE',ROAD:'RD',DRIVE:'DR',BOULEVARD:'BLVD',LANE:'LN',
  PLACE:'PL',COURT:'CT',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W'};
function normalStreet(value) {
  return value.toUpperCase().trim().replaceAll('.','').split(/\s+/).map(word=>streetTerms[word] || word).join(' ');
}
const unavailable = () => new TaxReview('The delivery location needs verification.');

function matchedGeography(address, matches) {
  if (matches?.length!==1) throw unavailable();
  const [match] = matches;
  const parts = match.addressComponents;
  const geography = match.geographies;
  if (parts?.state!==address.state || parts.zip!==address.postal_code.slice(0,5) ||
      parts.city!==address.city.toUpperCase() || typeof match.matchedAddress!=='string' ||
      normalStreet(match.matchedAddress.split(',')[0])!==normalStreet(address.address_line_1) ||
      geography?.States?.length!==1 || geography.States[0].STUSAB!==address.state) throw unavailable();
  return geography;
}

export function censusRates(address, day, matches) {
  // Stop at the quarter boundary until the publications have been reviewed again.
  if (day<'2026-11-26' || day>'2026-12-31' || !Object.hasOwn(publications,address.state)) throw unavailable();
  const [stateId,source] = publications[address.state];
  const geography = matchedGeography(address,matches);
  if (geography.States[0].GEOID!==stateId) throw unavailable();
  const state = address.state;
  const rates = [];
  let maxPassOn;
  if (state==='DC' || state==='ME') {
    rates.push({level:state==='DC'?'district':'state',code:state,ppm:state==='DC'?60000:55000});
  } else if (state==='HI') {
    const counties = geography.Counties;
    if (counties?.length!==1 || !['15001','15003','15007','15009'].includes(counties[0].GEOID)) throw unavailable();
    rates.push({level:'state',code:state,ppm:40000},{level:'county',code:counties[0].GEOID,ppm:5000});
    maxPassOn=47120;
  } else {
    const town = geography['County Subdivisions'];
    if (town?.length!==1 || geography.Counties?.length!==1 || geography.Counties[0].GEOID!=='50007' ||
        !['Burlington city','South Burlington city','Williston town'].includes(town[0].NAME) ||
        !/^50007\d{5}$/.test(town[0].GEOID)) throw unavailable();
    rates.push({level:'state',code:state,ppm:60000},{level:'city',code:town[0].GEOID,ppm:10000});
  }
  return {state,source,approval:'approved',verified_on:'2026-11-26',valid_from:day,valid_until:day,
    version:['government',day,...rates.map(r=>r.code+'-'+r.ppm)].join('/'),rates,max_pass_on_ppm:maxPassOn};
}

async function censusMatches(address, fetcher) {
  const target = new URL(census);
  target.search = new URLSearchParams({street:address.address_line_1,city:address.city,state:address.state,
    zip:address.postal_code.slice(0,5),benchmark:'Public_AR_Current',vintage:'Current_Current',format:'json'}).toString();
  try {
    const response = await fetcher(target,{signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store'});
    if (!response.ok) throw unavailable();
    return (await response.json()).result?.addressMatches;
  } catch { throw unavailable(); }
}

export async function destinationRates(address,day,fetcher=fetch) {
  return censusRates(address,day,await censusMatches(address,fetcher));
}

export async function confirmDestination(address,day,fetcher=fetch) {
  const geography=matchedGeography(address,await censusMatches(address,fetcher));
  // No rate is inferred from a state match. A taxable base still requires rates.
  return {state:address.state,source:census,approval:'approved',verified_on:day,valid_from:day,valid_until:day,
    version:'Census/'+day+'/'+geography.States[0].GEOID,rates:[]};
}
