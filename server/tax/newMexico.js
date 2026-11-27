import schedule from './newMexicoLocations.json' with {type:'json'};
import {TaxReview} from './engine.js';

const url = 'https://grt.edacnm.org/api/by_address';
const source = 'https://www.tax.newmexico.gov/grt-rate-finder-tools/';
const direction = /^(N|S|E|W|NE|NW|SE|SW)$/;
const suffix = /^(ST|STREET|AVE|AVENUE|DR|DRIVE|RD|ROAD|BLVD|BOULEVARD|LN|LANE|CT|COURT|PL|PLACE|WAY|CIR|CIRCLE|TRL|TRAIL|PKWY|PARKWAY)$/;

export async function newMexicoAddress(address, day, fetcher = fetch) {
  const unavailable = () => new TaxReview('The delivery location needs verification.');
  if(address.state!=='NM' || day<schedule.valid_from || day>schedule.valid_until) throw unavailable();
  const words = address.address_line_1.toUpperCase().trim().split(/\s+/);
  const street_number = words.shift();
  if (!/^\d+$/.test(street_number)) throw unavailable();
  const pre_direction = direction.test(words[0]) ? words.shift() : '';
  const street_post_directional = direction.test(words.at(-1)) ? words.pop() : '';
  const street_suffix = suffix.test(words.at(-1)) ? words.pop() : '';
  if (!words.length) throw unavailable();
  const fields = {street_number, pre_direction, street_name: words.join(' '), street_suffix,
    street_post_directional, city: address.city.toUpperCase(), zipcode: address.postal_code.slice(0,5)};
  try {
    const target = new URL(url);
    target.search = new URLSearchParams(fields).toString();
    const response = await fetcher(target, {signal: AbortSignal.timeout(4500), redirect: 'error', cache: 'no-store'});
    if (!response.ok) throw unavailable();
    const {results} = await response.json();
    if (!Array.isArray(results) || results.length !== 1) throw unavailable();
    const [row] = results;
    if (row.success !== true || !['Intuit','NM E911'].includes(row.source) ||
        !/^\d{2}-\d{3}$/.test(row.location_code) || !row.county ||
        Object.entries(fields).some(([k,v]) => String(row[k] ?? '').trim().toUpperCase() !== v)) throw unavailable();
    const rate = /^(\d{1,2})(?:\.(\d{1,4}))?$/.exec(String(row.tax_rate));
    if (!rate) throw unavailable();
    const ppm = Number(rate[1])*10000 + Number((rate[2] || '').padEnd(4,'0'));
    if (ppm <= 0 || ppm > 200000) throw unavailable();
    const locations=schedule.locations.filter(location=>location.code===row.location_code &&
      location.county.toUpperCase()===row.county.trim().toUpperCase());
    if(!locations.length || locations.some(location=>location.ppm!==ppm)) throw unavailable();
    const names=[...new Set(locations.map(location=>location.name))];
    return {state: 'NM', approval:'approved', valid_from:schedule.valid_from, valid_until:schedule.valid_until, verified_on:day,
      source, version:`NM-TRD/${day}/${row.location_code}/${ppm}`,
      rates:[{code:row.location_code,level:'combined',name:names.length===1?names[0]:row.location_code,county:row.county,ppm}]};
  } catch { throw unavailable(); }
}
