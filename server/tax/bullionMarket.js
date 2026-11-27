import {cents,current,TaxReview} from './engine.js';

const calendar='https://www.cs.ny.gov/attendance_leave/2026_legal_holidays.cfm';
const holidays=new Set(['2026-11-26','2026-12-25']);
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const specifications=new Map([
  ['GOTS-GBP-1OZ-RY-001',{metal:'gold',form:'coin',face_usd_cents:5000,gross_micro_oz:1000000}],
  ['GOTS-834790',{metal:'gold',form:'bar',catalogWeight:32.15,
    // One kilogram at .9999 fineness, divided by 31.1034768 g per troy ounce.
    fine_oz_numerator:9999000000,fine_oz_max_numerator:10000000000,fine_oz_denominator:311034768}],
  ['AGE-1OZ-BU-RY',{metal:'gold',form:'coin',face_usd_cents:5000,gross_micro_oz:1090900}],
  ['MAPLE-1OZ-BU-RY',{metal:'gold',form:'coin',cadCents:5000,gross_micro_oz:1000000}],
  ['SML-1OZ-BU-RY',{metal:'silver',form:'coin',cadCents:500}],
  ['PAMP-1OZ-FORTUNA-ASSAY',{metal:'gold',form:'bar'}],
  ['APMEX-1OZ-TEP',{metal:'gold',form:'bar'}],
  ['RAND-0033',{metal:'gold',form:'bar'}],
]);
const unavailable=()=>new TaxReview('The dated bullion closing price for this order needs verification.');

export function previousMarketDay(day){
  if (!/^2026-(11|12)-\d{2}$/.test(day) || day<'2026-11-26' || day>'2026-12-31') throw unavailable();
  const date=new Date(day+'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==day) throw unavailable();
  let prior;
  do {
    date.setUTCDate(date.getUTCDate()-1);
    prior=date.toISOString().slice(0,10);
  } while ([0,6].includes(date.getUTCDay()) || holidays.has(prior));
  return prior;
}

function publication(date){
  const [year,month,day]=date.split('-');
  const monthName=months[Number(month)-1];
  return {url:'https://www.ausecure.com/gold-market-close-'+monthName.toLowerCase()+'-'+Number(day)+'-'+year+'/',
    label:monthName+' '+Number(day)+', '+year};
}

export function parseClosingNote(html,date){
  const {url,label}=publication(date);
  if (!html.includes('<link rel="canonical" href="'+url+'"') || !html.includes('5:00 PM ET close on '+label+'.')) throw unavailable();
  const prices={};
  for (const metal of ['Gold','Silver']) {
    const marker='<h3>'+metal+'</h3>';
    const sections=html.split(marker);
    if (sections.length!==2) throw unavailable();
    const match=/^\s*<p class="p n">\$((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})<\/p>/.exec(sections[1]);
    if (!match) throw unavailable();
    const price=cents(match[1].replaceAll(',',''));
    if (!price) throw unavailable();
    prices[metal.toLowerCase()]=price;
  }
  return prices;
}

async function officialResponse(url,fetcher){
  const response=await fetcher(url,{signal:AbortSignal.timeout(5500),redirect:'error',cache:'no-store'});
  if (!response.ok) throw unavailable();
  return response;
}

// Price the face value using the official CAD-per-USD observation for the sale date.
export async function canadianDollar(day,fetcher){
  const url='https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date='+day+'&end_date='+day;
  const response=await officialResponse(url,fetcher);
  const {observations}=await response.json();
  if (observations?.length!==1 || observations[0].d!==day) throw unavailable();
  const value=observations[0].FXUSDCAD?.v;
  if (typeof value!=='string' || !/^\d{1,2}\.\d{4}$/.test(value)) throw unavailable();
  const divisor=Number(value.replace('.',''));
  if (!divisor) throw unavailable();
  return {url,cadPerUsdTenThousandths:divisor,usdCents:cadCents=>Math.floor((cadCents*10000+divisor/2)/divisor)};
}

export async function completeNyMarketInputs(products,day,fetcher=fetch){
  const missing=Object.entries(products ?? {}).filter(([,rule])=>rule?.origin==='catalog_policy_release_2026_11_26' &&
    current(rule,day) && rule.treatment==='eligible' && rule.market_day!==day &&
    specifications.has(rule.catalog_sku) && Number(rule.catalog_weight)===(specifications.get(rule.catalog_sku).catalogWeight ?? 1));
  if (!missing.length) return products;
  const prior=previousMarketDay(day),source=publication(prior).url;
  try {
    const needsFx=missing.some(([,rule])=>specifications.get(rule.catalog_sku).cadCents);
    const [market,fx]=await Promise.all([
      officialResponse(source,fetcher).then(r=>r.text()).then(html=>parseClosingNote(html,prior)),
      needsFx?canadianDollar(day,fetcher).catch(()=>null):null,
    ]);
    const result={...products};
    for (const [id,rule] of missing) {
      const {metal,form,cadCents,catalogWeight,...face}=specifications.get(rule.catalog_sku);
      if (metal!==rule.metal || form!==rule.form) throw unavailable();
      result[id]={...rule,...face,market_day:day,prior_business_day:prior,market_observed_on:prior,
        market_unit_cents:market[metal],market_source:source,market_calendar_source:calendar,market_basis:'cash_close',
        ...(cadCents ? {face_usd_cents:fx?.usdCents(cadCents) ?? null,face_fx_source:fx?.url ?? null,
          face_fx_observed_on:fx ? day : null, face_currency:'CAD', face_currency_cents:cadCents} : {})};
    }
    return result;
  } catch { throw unavailable(); }
}

export async function completeOrderMarketInputs(state,products,day,investment,fetcher=fetch) {
  if(state==='NY' && investment===true)return completeNyMarketInputs(products,day,fetcher);
  const foreign=Object.entries(products ?? {}).filter(([,rule])=>current(rule,day) && ['fl_foreign_coin_group','nv_coin_face_premium'].includes(rule.value_test)
    && rule.denomination_currency==='CAD' && rule.face_fx_observed_on!==day);
  if(!['NV','FL'].includes(state) || !foreign.length)return products;
  const fx=await canadianDollar(day,fetcher).catch(()=>null);
  if(!fx)return products;
  const result={...products};
  for(const [key,rule] of foreign)result[key]={...rule,face_usd_cents:fx.usdCents(rule.denomination_cents),cad_per_usd_10000:fx.cadPerUsdTenThousandths,face_fx_source:fx.url,face_fx_observed_on:day};
  return result;
}
