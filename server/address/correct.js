import {createHash} from 'node:crypto';
import {readyToCheck,stateCode,zipFormat} from '../../shared/deliveryAddress.js';
import {postalMatch} from './usps.js';

const fields=['address_line_1','address_line_2','city','state','postal_code','country'];
const clean = s=>s.trim().replace(/\s+/g,' ').toUpperCase();
const comparable=s=>clean(s).replaceAll('.','');
const streetAliases={FIRST:'1ST',SECOND:'2ND',THIRD:'3RD',FOURTH:'4TH',FIFTH:'5TH',SIXTH:'6TH',SEVENTH:'7TH',EIGHTH:'8TH',NINTH:'9TH',TENTH:'10TH',ELEVENTH:'11TH',TWELFTH:'12TH',STREET:'ST',AVENUE:'AVE',ROAD:'RD',DRIVE:'DR',LANE:'LN',BOULEVARD:'BLVD',COURT:'CT',PLACE:'PL',PARKWAY:'PKWY',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW'};
const streetKey=s=>comparable(s).split(' ').map(w=>streetAliases[w]||w).join(' ');
const unitKey=s=>comparable(s).replace(/^(APARTMENT|APT)\s*/,'APT ').replace(/^(SUITE|STE)\s*/,'STE ').replace(/\s+/g,' ').trim();
const house=s=>comparable(s).match(/^(\d+(?:-\d+)?[A-Z]?(?: \d+\/\d+)?)(?:\s|$)/)?.[1];
const invalid=message=>({status:'needs_input',message});
const noMatch=()=>invalid('Check the street number, street name and ZIP code.');
const cache=new Map();

function prepare(input) {
  if(!input || fields.some(k=>typeof (input[k] ?? '')!=='string' || (input[k] || '').length>160 || /[\u0000-\u001f]/.test(input[k] || ''))) return null;
  const a=Object.fromEntries(fields.map(k=>[k,clean(input[k] || '')]));
  if(a.country!=='US' || (a.state && !stateCode(a.state))) return null;
  a.state=stateCode(a.state); a.postal_code=zipFormat(a.postal_code);
  if(!readyToCheck(a)) return null;
  const unit=a.address_line_1.match(/^(.+?)[,\s]+((?:(?:APARTMENT|APT|SUITE|STE|UNIT|FLOOR|FL|ROOM|RM)\.?\s+|#\s*)[A-Z0-9][A-Z0-9-]*)$/);
  if(unit) {
    if(a.address_line_2 && unitKey(unit[2])!==unitKey(a.address_line_2)) return null;
    a.address_line_1=unit[1].trim(); a.address_line_2=a.address_line_2 || unit[2];
  }
  return a;
}

// Only offer small spelling differences. A shared house number and ZIP can match many streets.
function nearbySpelling(left,right) {
  if(Math.abs(left.length-right.length)>2)return false;
  let previous=Array.from({length:right.length+1},(_,i)=>i);
  for(let i=1;i<=left.length;i++) {
    const row=[i];
    for(let j=1;j<=right.length;j++)row.push(Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+Number(left[i-1]!==right[j-1])));
    previous=row;
  }
  return previous[right.length]<=2;
}

function compare(input, candidate, precision) {
  const a=prepare(candidate);
  if(!a?.city || !a.state || !a.postal_code) return noMatch();
  const number=house(input.address_line_1);
  if(number ? number!==house(a.address_line_1) : streetKey(input.address_line_1)!==streetKey(a.address_line_1)) return noMatch();
  if(input.address_line_2 && unitKey(input.address_line_2)!==unitKey(a.address_line_2)) return invalid('Check the apartment or suite number.');
  const sameStreet=streetKey(input.address_line_1)===streetKey(a.address_line_1);
  const samePlace=comparable(input.city)===comparable(a.city) && input.state===a.state;
  const sameZip=input.postal_code.slice(0,5)===a.postal_code.slice(0,5);
  if(!sameZip && !samePlace) return noMatch();
  if(!sameStreet && !nearbySpelling(streetKey(input.address_line_1),streetKey(a.address_line_1))) return noMatch();
  const sameExtension=input.postal_code.length<=5 || input.postal_code===a.postal_code;
  const sameEnteredPlace=(!input.city || comparable(input.city)===comparable(a.city)) && (!input.state || input.state===a.state);
  const exact=sameStreet && sameEnteredPlace && (!input.postal_code || sameZip) && sameExtension && unitKey(input.address_line_2)===unitKey(a.address_line_2);
  const fill=exact?['city','state','postal_code'].filter(k=>!input[k]):[];
  return {status:exact?'matched':'suggestion',address:a,precision,fill};
}
async function censusLookup(a,fetcher,by) {
  const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/address');
  const query={street:a.address_line_1,benchmark:'Public_AR_Current',format:'json'};
  if(by!=='zip') {if(a.city) query.city=a.city;if(a.state) query.state=a.state;}
  if(by!=='place' && a.postal_code) query.zip=a.postal_code.slice(0,5);
  url.search=new URLSearchParams(query).toString();
  const r=await fetcher(url,{signal:AbortSignal.timeout(4500),cache:'no-store',redirect:'error'});
  if(!r.ok) throw Error('Address service unavailable');
  const rows=(await r.json()).result?.addressMatches;
  if(!Array.isArray(rows)) throw Error('Invalid Census response');
  return rows;
}
function censusCandidate(row,a) {
  const parts=row?.addressComponents;
  if(!parts || !stateCode(parts.state) || !parts.city || !/^\d{5}$/.test(parts.zip) || typeof row.matchedAddress!=='string') return null;
  return {address_line_1:row.matchedAddress.split(',')[0],address_line_2:a.address_line_2,city:parts.city,state:parts.state,
    postal_code:parts.zip===a.postal_code.slice(0,5)?a.postal_code:parts.zip,country:'US'};
}
export async function correctDeliveryAddress(input,{fetcher=fetch,postal=process.env.USPS_ADDRESS_ENABLED==='true',useCache=true}={}) {
  const a=prepare(input);
  if(!a) return invalid('Enter a US street address and a ZIP code, or a city and state. Check any apartment or suite number.');
  const key=createHash('sha256').update(JSON.stringify([postal,a])).digest('hex');
  const previous=useCache && cache.get(key);
  if(previous && previous.until>Date.now())return previous.result;
  try {
    let result;
    if(postal) {
      let postalInput=a;
      if(!a.state) {
        const options=await censusLookup(a,fetcher,'zip');
        if(options.length!==1)return invalid('Enter the state to check this address.');
        const candidate=censusCandidate(options[0],a);
        if(!candidate || candidate.postal_code.slice(0,5)!==a.postal_code.slice(0,5))return invalid('Enter the state to check this address.');
        postalInput={...a,state:candidate.state};
      }
      const match=await postalMatch(postalInput,fetcher);
      result=match.address?compare(a,match.address,match.precision):match;
    } else {
      let rows=await censusLookup(a,fetcher,'all');
      if(!rows.length && a.city && a.state && a.postal_code) {
        const alternatives=await Promise.all([censusLookup(a,fetcher,'zip'),censusLookup(a,fetcher,'place')]);
        rows=alternatives.flat();
      }
      const options=new Map();
      for(const row of rows) {
        const candidate=censusCandidate(row,a);
        if(!candidate) continue;
        const checked=compare(a,candidate,'street_range');
        if(checked.address) {
          const location=row.tigerLine?.tigerLineId ? [row.tigerLine.tigerLineId,row.tigerLine.side] : row.coordinates;
          options.set(JSON.stringify([checked.address,location]),checked);
        }
      }
      result=options.size===1 ? [...options.values()][0] : options.size ? invalid('More than one address matches. Check the street direction, city and ZIP code.') : noMatch();
    }
    if(useCache && result.status==='matched') {
      if(cache.size>=256)cache.delete(cache.keys().next().value);
      cache.set(key,{result,until:Date.now()+300000});
    }
    return result;
  } catch {
    return {status:'unavailable',message:'Address lookup is temporarily unavailable. Try again.'};
  }
}
