export const acknowledgment='I acknowledge that I have received the merchandise described above from Gold On The Spot. The merchandise was physically handed to me, and I confirm receipt of the listed items.';
export const serialAcknowledgment='I acknowledge receipt of the items bearing the serial numbers listed above.';
export const deliveryMethods=['Shipping','Personal Delivery','Insured Courier','Customer Pickup'];
export const deliveryStates=['Pending','Preparing','Out for Delivery','Delivered','Failed Delivery'];
export const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n));
export const timeLabel=v=>v?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(v))+' ET':'';
export function unitText(u){return [u.serial&&'Serial: '+u.serial,u.manufacturer&&'Manufacturer: '+u.manufacturer,u.assay&&'Assay: '+u.assay,u.weight&&'Actual weight: '+u.weight,u.purity&&'Purity: '+u.purity].filter(Boolean).join('   ·   ')}
