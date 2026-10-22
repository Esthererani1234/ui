// Display estimate only. The database computes and locks the payable amount.
export function estimateShipping(items,subtotal,settings){
 if(!items.length)return 0;
 const cents=Math.round(Number(subtotal)*100);
 return Math.max(...items.map(({product})=>{
  const threshold=Number(product.free_shipping_minimum ?? settings.free_shipping_threshold ?? 5000);
  const fee=Number(product.shipping_fee ?? settings.shipping_flat ?? 35);
  return cents>=Math.round(threshold*100)?0:Math.round(fee*100);
 }))/100;
}
