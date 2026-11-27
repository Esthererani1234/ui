import {orderTotalCents} from '../tax/orderAmounts.js';
import {wireSettings} from './payments.js';
export function assertWireInstructionsAvailable(order,now=Date.now()) {
 if(order.payment_method!=='wire')throw Object.assign(new Error('Wire instructions are not available for this order.'),{status:404});
 if(!['pending_review','awaiting_payment'].includes(order.status)||!['unpaid','pending','failed','partially_paid'].includes(order.payment_status))
  throw Object.assign(new Error('This order is not awaiting a wire. View the latest order status or contact support.'),{status:409});
 const deadline=Date.parse(order.payment_due_at);
 if(!Number.isFinite(deadline)||deadline<=now)throw Object.assign(new Error('The wire payment deadline has passed. Contact support before sending funds.'),{status:409});
}
export async function wireOrderInstructions(order) {
 assertWireInstructionsAvailable(order);
 if(order.tax_amount!=null)orderTotalCents(order);
 const instructions=await wireSettings();
 return {order_number:order.order_number,total:order.total,...(order.tax_amount!=null?{tax_amount:order.tax_amount}:{}),reference:order.payment_reference||order.order_number,
 due_at:order.payment_due_at,instructions,agreement:order.wire_accepted_at?{version:order.wire_agreement_version,text:order.wire_agreement_text,accepted_at:order.wire_accepted_at}:null};
}
