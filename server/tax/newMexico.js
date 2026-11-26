import {TaxReview} from './engine.js';

const url = 'https://grt.edacnm.org/api/by_address';
const source = 'https://www.tax.newmexico.gov/grt-rate-finder-tools/';
const direction = /^(N|S|E|W|NE|NW|SE|SW)$/;
const suffix = /^(ST|STREET|AVE|AVENUE|DR|DRIVE|RD|ROAD|BLVD|BOULEVARD|LN|LANE|CT|COURT|PL|PLACE|WAY|CIR|CIRCLE|TRL|TRAIL|PKWY|PARKWAY)$/;

export async function newMexicoAddress(address, day, fetcher = fetch) {
  const unavailable = () => new TaxReview('The delivery location needs verification.');
  const words = address.address_line_1.toUpperCase().trim().split(/\s+/);
  const street_number = words.shift();
  if (!/^\d+$/.test(street_number)) throw unavailable();
  const pre_direction = direction.test(words[0]) ? words.shift() : '';
  const street_post_directional = direction.test(words.at(-1)) ? words.pop() : '';
  const street_suffix = suffix.test(words.at(-1)) ? words.pop() : '';
  if (!street_suffix || !words.length) throw unavailable();
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
    return {state: 'NM', approval:'approved', valid_from:day, valid_until:day, verified_on:day,
      source, version:`NM-TRD/${day}/${row.location_code}/${ppm}`,
      rates:[{code:row.location_code,level:'combined',ppm}]};
  } catch { throw unavailable(); }
}
