import {TaxReview} from './engine.js';
const source='https://dor.wa.gov/wa-sales-tax-rate-lookup-url-interface';
function ppm(rate){
  if(!/^0?\.\d{1,6}$/.test(rate))throw new TaxReview('Washington returned an unrecognized rate.');
  return Number(rate.split('.')[1].padEnd(6,'0'));
}
export function washingtonResult(xml,day){
  const tag=xml.match(/<response\b([^>]*)>/i)?.[1]||'';
  const attrs=Object.fromEntries([...tag.matchAll(/\b(\w+)="([^"]*)"/g)].map(m=>[m[1].toLowerCase(),m[2]]));
  if(attrs.code!=='0'||!/^\d{4}$/.test(attrs.loccode))throw new TaxReview('Washington could not match the full street address.');
  const total=ppm(attrs.rate),local=ppm(attrs.localrate);
  if(local>total||total>200000||total===0)throw new TaxReview('Washington rate components need review.');
  return {state:'WA',source,approval:'approved',valid_from:day,valid_until:day,verified_on:day,version:['WA-DOR',day,attrs.loccode,total,local].join('/'),rates:[
    {level:'state',code:'WA',ppm:total-local},{level:'combined_local',code:attrs.loccode,ppm:local}]};
}
export async function washingtonAddress(address,day,fetcher=fetch){
  const url=new URL('https://webgis.dor.wa.gov/webapi/AddressRates.aspx');
  url.search=new URLSearchParams({output:'xml',addr:[address.address_line_1,address.address_line_2].filter(Boolean).join(' '),city:address.city,zip:address.postal_code}).toString();
  try{
    const res=await fetcher(url,{signal:AbortSignal.timeout(4500),cache:'no-store',redirect:'error'});
    if(!res.ok)throw Error();return washingtonResult(await res.text(),day);
  }catch{throw new TaxReview('Washington address and rate verification is unavailable.');}
}
