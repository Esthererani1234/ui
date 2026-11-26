import {randomUUID} from 'node:crypto';
import {rpc} from './admin.js';
import {TaxReview} from './engine.js';
export async function saveEvidence(db,user,state,d){
  if(!['permit','filing','payment','exemption'].includes(d.kind)||typeof d.name!=='string'||!d.name.trim()||d.name.length>150||typeof d.base64!=='string')throw new TaxReview('Choose a document and type.');
  const bytes=Buffer.from(d.base64,'base64');
  if(!bytes.length||bytes.length>2097152)throw new TaxReview('Choose a file no larger than 2 MB.');
  const type=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;
  if(!type)throw new TaxReview('Choose a PDF, PNG or JPEG file.');
  const id=randomUUID(),path=state+'/'+id,bucket=db.storage.from('tax-compliance-private');
  const {error}=await bucket.upload(path,bytes,{contentType:type,upsert:false});
  if(error)throw new TaxReview('The protected file could not be saved.');
  try{await rpc(db,'tax_record_document',{p_actor:user,p_state:state,p_id:id,p_kind:d.kind,p_name:d.name,p_path:path});}
  catch(e){await bucket.remove([path]);throw e;}
}
