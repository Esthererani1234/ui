const states = 'AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC District of Columbia|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming'.split('|');
const stateCodes = new Map(states.flatMap(entry=>[[entry.slice(0,2),entry.slice(0,2)],[entry.slice(3).toUpperCase(),entry.slice(0,2)]]));
export const stateCode = value => stateCodes.get(String(value || '').trim().toUpperCase()) || '';
export const zipFormat = value => String(value || '').trim().replace(/^(\d{5})[ -]?(\d{4})$/, '$1-$2');
export function draftAddress(draft) {
  return {address_line_1:draft.address1 || '',address_line_2:draft.address2 || '',city:draft.city || '',
    state:draft.state || '',postal_code:draft.postalCode || '',country:'US'};
}
export function addressFields(address) {
  return {address1:address.address_line_1,address2:address.address_line_2,city:address.city,state:address.state,postalCode:address.postal_code};
}
export function readyToCheck(address) {
  if (!address?.address_line_1?.trim() || address.country!=='US') return false;
  const zip=zipFormat(address.postal_code);
  return (!zip || /^\d{5}(-\d{4})?$/.test(zip)) && (Boolean(zip) || Boolean(address.city?.trim() && stateCode(address.state)));
}

export function fillAddressFields(draft,address,missing) {
  const values=addressFields(address);
  const names={city:'city',state:'state',postal_code:'postalCode'};
  const update=Object.fromEntries(missing.map(k=>names[k]).filter(k=>!draft[k]?.trim()).map(k=>[k,values[k]]));
  return Object.keys(update).length?{...draft,...update}:draft;
}
