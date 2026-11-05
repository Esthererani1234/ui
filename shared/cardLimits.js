export const CARD_CART_MAXIMUM = 10000;
export const CARD_CHARGE_MAXIMUM = 10450;
export function cardLimitMessage(subtotal,total,configuredMaximum=CARD_CHARGE_MAXIMUM){
 const items=Number(subtotal),charge=Number(total),configured=Number(configuredMaximum);
 if(!Number.isFinite(items)||items<0||!Number.isFinite(charge)||charge<=0||!Number.isFinite(configured)||configured<=0)return 'Card pricing is unavailable. Refresh your quote.';
 if(Math.round(items*100)>CARD_CART_MAXIMUM*100)return 'Card payments are limited to $10,000 in merchandise. Please choose bank wire or reduce your cart.';
 if(Math.round(charge*100)>Math.round(Math.min(configured,CARD_CHARGE_MAXIMUM)*100))return 'This order exceeds the card payment limit after fees and shipping. Please choose bank wire or reduce your cart.';
 return '';
}
