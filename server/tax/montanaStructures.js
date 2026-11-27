import inventory from './montanaCounties.json' with {type:'json'};

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

export async function montanaStructureEvidence(address,day,geography,fetcher=fetch){
  const county=inventory.point_counties[geography?.county?.geoid];
  if(!county || address.state!=='MT' || day<inventory.reviewed_on || day>inventory.through || address.address_line_2?.trim())return null;
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
  if(matches.length!==1)return null;
  const {attributes:a,geometry}=matches[0];
  if(a.County!==county || a.Placement!=='Structure' || !a.NGUID || !Number.isFinite(a.DateUpdate) || a.DateUpdate>=dayEnd ||
    (a.Effective!=null && a.Effective>dayStart) || (a.Expire!=null && a.Expire<dayEnd) ||
    !outsidePublishedAreas(geometry?.x,geometry?.y))return null;
  return {state:'MT',day,scope:'structure_outside_resort_areas',geography,source,point_id:a.NGUID,
    point_updated:new Date(a.DateUpdate).toISOString().slice(0,10),boundary_sources:inventory.sources,
    verified_on:inventory.reviewed_on,valid_until:inventory.through};
}
