import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import quarter from './washingtonQuarter.json' with {type:'json'};
import {TaxReview} from './engine.js';

const source='https://dor.wa.gov/wa-sales-tax-rate-lookup-url-interface';
const failure=()=>new TaxReview('We couldn’t verify the rate for this Washington address.');
const terms={STREET:'ST',AVENUE:'AVE',ROAD:'RD',DRIVE:'DR',BOULEVARD:'BLVD',LANE:'LN',COURT:'CT',
  PLACE:'PL',PARKWAY:'PKWY',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW'};
const normalize=s=>s.trim().toUpperCase().replaceAll('.','').split(/\s+/).map(w=>terms[w]||w).join(' ');

function destination(address) {
  if(address?.state!=='WA' || !address.city?.trim() || !/^\d{5}(?:-\d{4})?$/.test(address.postal_code)) throw failure();
  const m=/^([1-9]\d*) (.+)$/.exec(normalize(address.address_line_1));
  if(!m || !Number.isSafeInteger(Number(m[1]))) throw failure();
  const [zip,plus4]=address.postal_code.split('-');
  return {number:Number(m[1]),street:m[2],zip,plus4,parity:Number(m[1])%2?'O':'E'};
}

function attributes(xml, name) {
  const tag=xml.match(new RegExp('<'+name+'\\b([^>]*)>','i'))?.[1] || '';
  return Object.fromEntries([...tag.matchAll(/\b(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
}
function ppm(value) {
  if(!/^0?\.\d{1,6}$/.test(value)) throw failure();
  return Number(value.split('.')[1].padEnd(6,'0'));
}

function inQuarter(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && 'Q'+Math.ceil(Number(day.slice(5,7))/3)+day.slice(0,4)===quarter.period;
}

// The address CSV is ordered by ZIP. Keep the official compressed download out of the frontend.
let archivePromise;
export async function loadWashingtonRanges() {
  if(!archivePromise) archivePromise=(async()=>{
    const res=await fetch(quarter.address_url,{redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!res.ok) throw failure();
    const file=Buffer.from(await res.arrayBuffer());
    if(file.length!==quarter.archive_bytes || createHash('sha256').update(file).digest('hex')!==quarter.sha256) throw failure();
    const data=inflateRawSync(file.subarray(quarter.offset,quarter.offset+quarter.compressed_bytes),{maxOutputLength:quarter.uncompressed_bytes});
    if(data.length!==quarter.uncompressed_bytes) throw failure();
    return data;
  })().catch(error=>{archivePromise=undefined;throw error;});
  return archivePromise;
}

// Require one jurisdiction across every matching row. Either side of a street may have a different code.
export function washingtonStreetCode(data,address) {
  const {number,street,parity,zip,plus4}=destination(address);
  const key=Buffer.from(','+street+',WA,'+zip+',');
  const codes=new Set();
  for(let pos=data.indexOf(key);pos!==-1;pos=data.indexOf(key,pos+key.length)) {
    const start=data.lastIndexOf(10,pos)+1;
    const end=data.indexOf(10,pos);
    const [low,high,side,,,,extension,period,code]=data.toString('utf8',start,end===-1?data.length:end).trimEnd().split(',');
    if(period===quarter.period && side===parity && (!plus4 || extension===plus4) &&
      /^\d+$/.test(low) && /^\d+$/.test(high) && number>=Number(low) && number<=Number(high)) codes.add(code);
  }
  if(codes.size!==1) throw failure();
  return [...codes][0];
}

export function washingtonResult(xml,day,address,streetCode) {
  const main=attributes(xml,'response'),street=attributes(xml,'addressline'),rate=attributes(xml,'rate');
  const input=destination(address);
  const record=quarter.rates[streetCode];
  if(!inQuarter(day) || !record || day<record[2] || day>record[3] ||
    !['0','2'].includes(main.code) || main.loccode!==streetCode || street.code!==streetCode || rate.code!==streetCode ||
    street.period!==quarter.period || street.state!=='WA' || street.zip!==input.zip ||
    (input.plus4 && input.plus4!==street.plus4) || normalize(street.street || '')!==input.street ||
    !/^\d+$/.test(street.houselow) || !/^\d+$/.test(street.househigh) ||
    input.number<Number(street.houselow) || input.number>Number(street.househigh) || street.evenodd!==input.parity) throw failure();
  const [state,local]=record;
  if(ppm(main.rate)!==state+local || ppm(main.localrate)!==local || ppm(rate.staterate)!==state || ppm(rate.localrate)!==local) throw failure();
  return {state:'WA',source,approval:'approved',valid_from:day,valid_until:day,verified_on:day,
    version:['WA-DOR',quarter.period,streetCode,state,local].join('/'),
    rates:[{level:'state',code:'WA',ppm:state},{level:'combined_local',code:streetCode,ppm:local,
      name:record[5] || rate.name,county:record[4],districts:[street.ptba,street.rta==='Y'?'Regional Transit Authority':null].filter(Boolean)}]};
}

export async function washingtonAddress(address,day,fetcher=fetch,loadRanges=loadWashingtonRanges) {
  if(!inQuarter(day)) throw failure();
  const url=new URL('https://webgis.dor.wa.gov/webapi/AddressRates.aspx');
  url.search=new URLSearchParams({output:'xml',addr:[address.address_line_1,address.address_line_2].filter(Boolean).join(' '),city:address.city,zip:address.postal_code}).toString();
  try {
    const [res,ranges]=await Promise.all([fetcher(url,{signal:AbortSignal.timeout(6000),cache:'no-store',redirect:'error'}),loadRanges()]);
    if(!res.ok) throw failure();
    return washingtonResult(await res.text(),day,address,washingtonStreetCode(ranges,address));
  } catch {throw failure();}
}
