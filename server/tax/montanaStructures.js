import inventory from './montanaCounties.json' with {type:'json'};

import gallatin from './montanaGallatinBoundaries.json' with {type:'json'};
import {current} from './engine.js';

const source='https://gisservice.mt.gov/arcgis/rest/services/msdi_structures_addresses_map_v1/MapServer/0';
const streetFields=['AddNum_Pre','Add_Number','AddNum_Suf','St_PreMod','St_PreDir','St_PreTyp','St_PreSep','St_Name','St_PosTyp','St_PosDir','St_PosMod'];
const fields=['NGUID','State','County','Post_Comm','Post_Code','Placement','Effective','Expire','DateUpdate',...streetFields];
const abbreviations={STREET:'ST',AVENUE:'AVE',ROAD:'RD',BOULEVARD:'BLVD',DRIVE:'DR',LANE:'LN',
  COURT:'CT',PLACE:'PL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W'};
const normalize=value=>String(value||'').toUpperCase().trim().replaceAll('.','').split(/\s+/)
  .map(word=>abbreviations[word]||word).join(' ');

// A conservative envelope includes the whole published polygon. The extra
// 0.01 degree on each side also leaves a buffer for positional uncertainty.
function outsidePublishedAreas(x,y){
  return Number.isFinite(x) && Number.isFinite(y) && x>=-116.1 && x<=-104 && y>=44.3 && y<=49.1 &&
    inventory.resort_envelopes.length===inventory.feature_counts.designations+inventory.feature_counts.districts &&
    inventory.resort_envelopes.every(([west,south,east,north])=>x<west-0.01 || x>east+0.01 || y<south-0.01 || y>north+0.01);
}

// The published town and rural district each have a single, closed exterior
// ring. Leave addresses within 0.0015 degrees of either boundary in review.
// At this latitude that margin exceeds 100 m, including coordinate rounding.
function relationToRing(x,y,ring){
  let inside=false;
  for(let i=1;i<ring.length;i++){
    const [ax,ay]=ring[i-1],[bx,by]=ring[i],dx=bx-ax,dy=by-ay;
    const len=dx*dx+dy*dy;
    const t=len?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/len)):0;
    if(Math.hypot(x-ax-t*dx,y-ay-t*dy)<=0.0015)return 'boundary';
    if((ay>y)!==(by>y) && x<ax+(y-ay)*dx/dy)inside=!inside;
  }
  return inside?'inside':'outside';
}

function gallatinEvidence(x,y,geography,rule){
  const town=relationToRing(x,y,gallatin.town),rural=relationToRing(x,y,gallatin.rural);
  const place=geography.municipality;
  if(town==='inside' && rural==='outside' && place?.geoid==='3079525' && place.name==='West Yellowstone town')
    return {scope:'town_resort_district',district_name:'Town of West Yellowstone',source:rule.town_source,
      resort_components:[{name:'Base resort tax',ppm:rule.town_base_ppm},{name:'Infrastructure',ppm:rule.town_infrastructure_ppm}]};
  if(rural==='inside' && town==='outside' && !place)
    return {scope:'rural_resort_district',district_name:'Hebgen Basin Rural Resort Area District',source:rule.rural_source,
      resort_components:[{name:'Resort tax',ppm:rule.rural_ppm}]};
  return null;
}

export async function montanaStructureEvidence(address,day,geography,fetcher=fetch,gallatinRule){
  const county=inventory.point_counties[geography?.county?.geoid];
  if(!county || address.state!=='MT' || day<inventory.reviewed_on || day>inventory.through || address.address_line_2?.trim())return null;
  const isGallatin=geography.county.geoid==='30031';
  if(isGallatin && (!current(gallatinRule,day) || gallatinRule.state!=='MT' || gallatinRule.county!=='30031' ||
    gallatinRule.scope!=='gallatin_resort_geography' || geography.state?.geoid!=='30' ||
    !gallatinRule.town_source?.startsWith('https://') || !gallatinRule.rural_source?.startsWith('https://')))return null;
  const house=/^(\d{1,6})\s/.exec(address.address_line_1?.trim());
  const zip=/^(\d{5})(?:-\d{4})?$/.exec(address.postal_code);
  if(!house || !zip || !address.city?.trim())return null;
  const url=new URL(source+'/query');
  url.search=new URLSearchParams({f:'json',where:"Add_Number="+Number(house[1])+" AND Post_Code='"+zip[1]+"'",
    outFields:fields.join(','),returnGeometry:'true',outSR:'4326'}).toString();
  const response=await fetcher(url,{signal:AbortSignal.timeout(4500),cache:'no-store',redirect:'error'});
  if(!response.ok)return null;
  const data=await response.json();
  if(data.error || data.exceededTransferLimit || data.geometryType!=='esriGeometryPoint' ||
    data.spatialReference?.wkid!==4326 || !Array.isArray(data.features))return null;
  const dayStart=Date.parse(day+'T00:00:00Z'),dayEnd=dayStart+86400000;
  const matches=data.features.filter(({attributes:a})=>a && a.State==='MT' && a.Post_Code===zip[1] &&
    normalize(a.Post_Comm)===normalize(address.city) &&
    normalize(streetFields.map(k=>a[k]).filter(Boolean).join(' '))===normalize(address.address_line_1));
  if(!matches.length || matches.length>(isGallatin?2:1))return null;
  if(matches.some(({attributes:a,geometry})=>a.County!==county || a.Placement!=='Structure' || !a.NGUID ||
    !Number.isFinite(a.DateUpdate) || a.DateUpdate>=dayEnd || (a.Effective!=null && a.Effective>dayStart) ||
    (a.Expire!=null && a.Expire<dayEnd) || !Number.isFinite(geometry?.x) || !Number.isFinite(geometry?.y)))return null;
  matches.sort((a,b)=>b.attributes.DateUpdate-a.attributes.DateUpdate || a.attributes.NGUID.localeCompare(b.attributes.NGUID));
  const {attributes:a,geometry:{x,y}}=matches[0];
  // The state and county sometimes publish the same physical structure. Accept
  // independent records only when they agree to within 0.12 m and neither
  // candidate is near a boundary. Distinct buildings remain unresolved.
  if(matches.length===2 && (matches[1].attributes.NGUID===a.NGUID ||
    Math.hypot(matches[1].geometry.x-x,matches[1].geometry.y-y)>0.000001))return null;
  const common={state:'MT',day,geography,point_id:a.NGUID,point_source:source,
    point_updated:new Date(a.DateUpdate).toISOString().slice(0,10),boundary_sources:inventory.sources,
    verified_on:inventory.reviewed_on,valid_until:inventory.through};
  if(isGallatin){
    common.boundary_sources=[...new Set([...inventory.sources,...gallatin.sources])];
    common.version=gallatinRule.version;
    common.point_ids=matches.map(m=>m.attributes.NGUID);
    const [left,bottom,right,top]=gallatin.county_envelope;
    if(matches.some(({geometry:g})=>g.x<left || g.x>right || g.y<bottom || g.y>top))return null;
    const [west,south,east,north]=gallatin.fire_envelope;
    if(x>=west-0.01 && x<=east+0.01 && y>=south-0.01 && y<=north+0.01){
      const district=gallatinEvidence(x,y,geography,gallatinRule);
      if(!district || matches.some(({geometry:g})=>gallatinEvidence(g.x,g.y,geography,gallatinRule)?.scope!==district.scope))return null;
      return {...common,...district};
    }
    if(geography.municipality?.geoid==='3079525')return null;
  }
  return matches.every(({geometry:g})=>outsidePublishedAreas(g.x,g.y))?{...common,scope:'structure_outside_resort_areas',source}:null;
}
