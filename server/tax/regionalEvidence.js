import alaska from './alaskaNovember.json' with {type:'json'};
import montana from './montanaCounties.json' with {type:'json'};
import {confirmDestination} from './destinationRates.js';

const alaskaMembers='https://arsstc.org/business-sellers/member-jurisdictions/';
const montanaDesignations='https://commerce.mt.gov/Data-Research/Resort-Tax-Analysis';
// These city-and-borough governments use one general-retail row across the
// consolidated jurisdiction. Other borough-only rows need tax-area evidence.
const consolidated=new Set(['02110','02220','02230','02275','02282']);
const covered=(dataset,day)=>day>=dataset.reviewed_on && day<=dataset.through;

export function regionalEvidence(state,day,location) {
  const county=location?.county?.geoid,place=location?.municipality?.geoid;
  if(!county)return null;
  if(state==='MT' && covered(montana,day) && Object.hasOwn(montana.outside,county)){
    return {state,day,scope:'outside_resort_areas',geography:location,source:montanaDesignations,
      boundary_sources:montana.sources,verified_on:montana.reviewed_on,valid_until:montana.through};
  }
  if(state!=='AK' || !covered(alaska,day))return null;
  if(county==='02020')return {state,day,scope:'no_general_retail_tax',geography:location,
    source:alaskaMembers,verified_on:alaska.reviewed_on,valid_until:alaska.through};
  const matches=alaska.combinations.filter(r=>r.county===county && !r.requires_area_code &&
    (r.place ? r.place===place : consolidated.has(county)));
  if(matches.length!==1)return null;
  const rates=matches[0].rates;
  if(rates.some(r=>r.collection_start>day || r.rate_from>day))return null;
  return {state,day,scope:'member_general_rates',geography:location,source:alaska.source,
    verified_on:alaska.reviewed_on,valid_until:alaska.through,source_sha256:alaska.sha256,rates};
}

export async function resolveRegionalEvidence(address,day,verify=confirmDestination){
  if(!address || !['AK','MT'].includes(address.state))return null;
  const match=await verify(address,day);
  return regionalEvidence(address.state,day,match.geography);
}

export async function alaskaReportAddress(address,day){
  const evidence=await resolveRegionalEvidence(address,day);
  if(evidence?.scope!=='member_general_rates')return null;
  return {state:'AK',source:evidence.source,verified_on:evidence.verified_on,valid_from:day,valid_until:evidence.valid_until,
    approval:'approved',version:['ARSSTC',evidence.source_sha256,...evidence.rates.map(r=>r.code)].join('/'),
    rates:evidence.rates,geography:evidence.geography,cap_basis:'arsstc_monthly_retail'};
}
