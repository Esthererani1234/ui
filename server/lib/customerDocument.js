import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {renderDeliveryPdf} from './deliveryPdf.js';
// Caller has already checked the session, SMS and order ownership.
export async function archivedCustomerInvoice(db,id,actor){
 const {data:state,error}=await db.rpc('order_document_state',{p_order:id});if(error||!state)throw Error('Order unavailable');
 const old=await db.from('order_issued_documents').select('pdf,snapshot').eq('order_id',id).eq('kind','invoice').order('created_at',{ascending:false}).limit(1);if(old.error)throw old.error;
 if(old.data.length){const {receipt,...snapshot}=old.data[0].snapshot;if(isDeepStrictEqual(state,snapshot))return Buffer.from(old.data[0].pdf,'base64')}
 const docId=randomUUID(),pdf=await renderDeliveryPdf(state,'invoice',docId,new Date().toISOString());
 const write=await db.rpc('order_document_action',{p_order:id,p_actor:actor,p_action:'owner_invoice',p_data:{id:docId,kind:'invoice',pdf:pdf.toString('base64')},p_expected:state});
 if(write.error)throw write.error;return pdf;
}
