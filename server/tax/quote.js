import {correctDeliveryAddress} from '../address/correct.js';
import {cleanCart,fetchRetailSpot} from '../lib/quotes.js';
import {confirmDestination} from './destinationRates.js';
import {streetRateResolvers} from './streetRates.js';
import {assess,cents,TaxReview} from './engine.js';
import {pickupAddress} from '../../shared/business.js';
export {pickupAddress};
export function normalizeAddress(a){
  if(!a || typeof a!=='object')throw new TaxReview('Enter a full delivery address.');
  const fields=Object.keys(pickupAddress);
  if(fields.some(k=>typeof (a[k]??'')!=='string'||String(a[k]??'').length>160))throw new TaxReview('Enter a valid delivery address.');
  const address=Object.fromEntries(fields.map(k=>[k,(a[k]||'').trim().toUpperCase()]));
  if(address.country!=='US'||!address.city||!address.address_line_1||!/^\d{5}(-\d{4})?$/.test(address.postal_code)||! /^[A-Z]{2}$/.test(address.state))throw new TaxReview('Enter the complete US street address, city, state and ZIP code.');
  return address;
}
export async function reviewQuote(db,userId,body){
  const estimate=body.mode==='estimate';
  if(!['card','wire','ach','crypto'].includes(body.method)||!['pickup','delivery'].includes(body.fulfillment)||typeof body.investment!=='boolean'||(!estimate && !/^([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(body.quote_id)))throw new TaxReview('Invalid tax quote request.');
  let address=normalizeAddress(pickupAddress);
  let addressCheck='pickup_office';
  if(body.fulfillment==='delivery') {
    const checked=await correctDeliveryAddress(body.address);
    if(checked.status!=='matched') {
      const error=new TaxReview(checked.message || 'Confirm the suggested delivery address before continuing.');
      error.code='ADDRESS_REVIEW';throw error;
    }
    address=normalizeAddress(checked.address);
    addressCheck=checked.precision;
  }
  const {data:inputs,error}=estimate?await db.rpc('tax_cart_inputs',{p_user:userId,p_cart:cleanCart(body.cart),p_spot:await fetchRetailSpot(),p_address:address}):await db.rpc('tax_quote_inputs',{p_user:userId,p_quote:body.quote_id,p_address:address});
  if(error||!inputs)throw new TaxReview('This quote or its jurisdiction data is unavailable. Refresh checkout and try again.');
  if (inputs.policy?.approval==='approved' && !inputs.policy.shipping_disabled && (!inputs.address || (address.state==='WA' && inputs.policy.collection==='collect'))) {
    const lookup = inputs.policy.collection==='no_obligation' ? confirmDestination : streetRateResolvers[address.state];
    if (lookup) inputs.address = await lookup(address,inputs.day);
    else if (inputs.policy.uniform_jurisdiction_base===true) inputs.address = await confirmDestination(address,inputs.day);
  }
  const q=inputs.quote;
  const subtotal=cents(q.subtotal);
  const calculation=assess({day:inputs.day,state:address.state,policy:inputs.policy,address:inputs.address,lines:q.line_items.map(i=>({id:i.product_id,quantity:i.quantity,gross:cents(i.line_total),classification:inputs.products?.[i.product_id]})),subtotal,shipping:body.fulfillment==='pickup'?0:cents(q.shipping_amount),fee:body.method==='card'?cents(q.card_surcharge):body.method==='ach'?Math.floor((subtotal+25)/50):0,investment:body.investment});
  calculation.address_check=addressCheck;
  if(estimate)return calculation;
  const {data:id,error:saveError}=await db.rpc('store_tax_assessment',{p_user:userId,p_quote:body.quote_id,p_address:address,p_method:body.method,p_fulfillment:body.fulfillment,p_result:{...calculation,investment:body.investment},p_revision:inputs.revision});
  if(saveError||!id)throw new TaxReview('Tax information changed. Refresh the quote before paying.');
  return {id,...calculation};
}
