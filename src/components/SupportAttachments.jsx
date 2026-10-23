import { useEffect, useRef, useState } from 'react';
import { supabase, readOnlyPreview } from '../lib/supabase';
import { invokeFunction } from '../lib/functionRequest';
import '../styles/sellingConversation.css';
import preparePhoto from '../lib/preparePhoto';
import ImageAttachmentButton from './ImageAttachmentButton';

export default function SupportAttachments({caseId,admin=false,enabled=true,onUploaded}) {
 const [messages,setMessages]=useState([]),[drafts,setDrafts]=useState({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[more,setMore]=useState(false),[photoBusy,setPhotoBusy]=useState(false);
 const generation=useRef(0),saving=useRef(false),requests=useRef({});
 const draft=drafts[caseId]||{text:'',photo:null};
 const change=patch=>setDrafts(old=>({...old,[caseId]:{text:'',photo:null,...old[caseId],...patch}}));
 const call=body=>invokeFunction(supabase,'support-case-photos',body,{timeout:25000});
 async function load(append=false){const run=++generation.current;setLoading(true);setError('');try{const result=await call({action:'read',case_id:caseId,offset:append?messages.length:0});if(!Array.isArray(result?.messages))throw new Error('The conversation could not be loaded. Please refresh.');if(run!==generation.current)return;setMessages(old=>append?[...old,...result.messages]:result.messages);setMore(result.has_more);}catch(e){if(run===generation.current)setError(e.message);}finally{if(run===generation.current)setLoading(false);}}
 useEffect(()=>{setMessages([]);setNotice('');setError('');setMore(false);if(enabled)load();return()=>{generation.current++}},[caseId,enabled]);
 async function attach(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;const run=generation.current;setPhotoBusy(true);setError('');try{const photo=await preparePhoto(file);if(run===generation.current)change({photo});}catch(e){if(run===generation.current)setError(e.message||'The photo could not be read.');}finally{setPhotoBusy(false);}}
 async function send(event){event.preventDefault();if(saving.current||photoBusy||readOnlyPreview||(!draft.text.trim()&&!draft.photo))return;saving.current=true;setBusy(true);setError('');setNotice('');const id=caseId,run=generation.current;const payload={action:'send',case_id:id,message:draft.text.trim(),photo:draft.photo};const signature=JSON.stringify(payload);if(requests.current[id]?.signature!==signature)requests.current[id]={signature,id:crypto.randomUUID()};try{await call({...payload,request_id:requests.current[id].id});setDrafts(old=>({...old,[id]:{text:'',photo:null}}));delete requests.current[id];if(run===generation.current){setNotice('Image attached to this ticket.');await Promise.all([load(),onUploaded?.()]);}}catch(e){if(run===generation.current)setError(e.message||'Could not send. Your draft is kept.');}finally{saving.current=false;setBusy(false);}}
 if(!enabled)return null;
 return <section className="selling-conversation" aria-label="Attachments">
  <header><div><h3>Attachments</h3><p>Photos shared with the customer and support team.</p></div><button className="button button-outline" type="button" disabled={loading||busy} onClick={()=>load()}>Refresh images</button></header>
  {loading&&<p role="status">Loading images…</p>}{error&&<p className="form-message error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="selling-thread">{messages.map(message=><article className={'selling-message '+message.sender_role} key={message.id}><div><b>{message.sender_role==='admin'?'Gold On The Spot':'Customer'}</b><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}</time></div>{message.body&&<p>{message.body}</p>}{message.photo_url&&<a href={message.photo_url} target="_blank" rel="noopener noreferrer"><img src={message.photo_url} alt="Photo attached to this support ticket" loading="lazy"/><span>Open photo</span></a>}</article>)}</div>
  {!loading&&!error&&!messages.length&&<p>Add a photo of the item or packaging.</p>}
  {more&&<button type="button" className="button button-outline" disabled={loading} onClick={()=>load(true)}>Load more images</button>}
  <form onSubmit={send}><div className="selling-photo-controls"><ImageAttachmentButton onChange={attach} disabled={busy||photoBusy||readOnlyPreview}/><small>Up to 6 photos per case. JPEG, PNG, or WebP. Photos are resized and camera location metadata is removed. No identity documents or payment details.</small></div>
   {photoBusy&&<p role="status">Preparing photo…</p>}{draft.photo&&<div className="selling-photo-preview"><img src={'data:image/jpeg;base64,'+draft.photo} alt="Photo ready to send"/><button type="button" className="text-button" disabled={busy} onClick={()=>change({photo:null})}>Remove photo</button></div>}
   <button className="button button-gold" disabled={busy||photoBusy||loading||readOnlyPreview||(!draft.text.trim()&&!draft.photo)}>{busy?'Uploading…':'Upload image'}</button>
  </form><small>Photos use temporary private links. Refresh the conversation if a link expires. Do not upload identity documents, card details, or bank information.</small>
 </section>;
}
