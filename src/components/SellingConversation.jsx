import { useEffect, useRef, useState } from 'react';
import { supabase, readOnlyPreview } from '../lib/supabase';
import { invokeFunction } from '../lib/functionRequest';
import '../styles/sellingConversation.css';

async function preparePhoto(file) {
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPEG, PNG, or WebP photo under 10 MB.');
 const url=URL.createObjectURL(file);
 try {
  const image=new Image();image.src=url;await image.decode();
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  // Re-encoding removes camera metadata, including embedded location information.
  const data=canvas.toDataURL('image/jpeg',.82).split(',')[1];
  if(!data||data.length>1398104)throw new Error('This photo is too large. Choose a smaller image.');
  return data;
 } finally {URL.revokeObjectURL(url);}
}
export default function SellingConversation({caseId,admin=false,enabled=true}) {
 const [messages,setMessages]=useState([]),[drafts,setDrafts]=useState({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[more,setMore]=useState(false),[photoBusy,setPhotoBusy]=useState(false);
 const generation=useRef(0),saving=useRef(false),requests=useRef({});
 const draft=drafts[caseId]||{text:'',photo:null};
 const change=patch=>setDrafts(old=>({...old,[caseId]:{text:'',photo:null,...old[caseId],...patch}}));
 const call=body=>invokeFunction(supabase,'sell-case-thread',body,{timeout:25000});
 async function load(append=false){const run=++generation.current;setLoading(true);setError('');try{const result=await call({action:'read',case_id:caseId,offset:append?messages.length:0});if(!Array.isArray(result?.messages))throw new Error('The conversation could not be loaded. Please refresh.');if(run!==generation.current)return;setMessages(old=>append?[...old,...result.messages]:result.messages);setMore(result.has_more);}catch(e){if(run===generation.current)setError(e.message);}finally{if(run===generation.current)setLoading(false);}}
 useEffect(()=>{setMessages([]);setNotice('');setError('');setMore(false);if(enabled)load();return()=>{generation.current++}},[caseId,enabled]);
 async function attach(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;const run=generation.current;setPhotoBusy(true);setError('');try{const photo=await preparePhoto(file);if(run===generation.current)change({photo});}catch(e){if(run===generation.current)setError(e.message||'The photo could not be read.');}finally{setPhotoBusy(false);}}
 async function send(event){event.preventDefault();if(saving.current||photoBusy||readOnlyPreview||(!draft.text.trim()&&!draft.photo))return;saving.current=true;setBusy(true);setError('');setNotice('');const id=caseId,run=generation.current;const payload={action:'send',case_id:id,message:draft.text.trim(),photo:draft.photo};const signature=JSON.stringify(payload);if(requests.current[id]?.signature!==signature)requests.current[id]={signature,id:crypto.randomUUID()};try{await call({...payload,request_id:requests.current[id].id});setDrafts(old=>({...old,[id]:{text:'',photo:null}}));delete requests.current[id];if(run===generation.current){setNotice('Sent. Your message is saved in this case.');await load();}}catch(e){if(run===generation.current)setError(e.message||'Could not send. Your draft is kept.');}finally{saving.current=false;setBusy(false);}}
 if(!enabled)return null;
 return <section className="selling-conversation" aria-label="Case conversation">
  <header><div><h3>Case conversation</h3><p>{admin?'Messages here are visible to the customer. Keep private notes in the notes area.':'Exchange details and photos with our buying desk. Return here for replies.'}</p></div><button className="button button-outline" type="button" disabled={loading||busy} onClick={()=>load()}>Refresh conversation</button></header>
  {loading&&<p role="status">Loading conversation…</p>}{error&&<p className="form-message error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="selling-thread">{messages.map(message=><article className={'selling-message '+message.sender_role} key={message.id}><div><b>{message.sender_role==='admin'?'Gold On The Spot':'Seller'}</b><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}</time></div>{message.body&&<p>{message.body}</p>}{message.photo_url&&<a href={message.photo_url} target="_blank" rel="noopener noreferrer"><img src={message.photo_url} alt="Photo submitted for this selling case" loading="lazy"/><span>Open photo</span></a>}</article>)}</div>
  {!loading&&!error&&!messages.length&&<p>No messages yet. Add details or photos below.</p>}
  {more&&<button type="button" className="button button-outline" disabled={loading} onClick={()=>load(true)}>Load more messages</button>}
  <form onSubmit={send}><label>Message to {admin?'seller':'buying desk'}<textarea rows={3} maxLength={2000} value={draft.text} disabled={busy} onChange={e=>change({text:e.target.value})} placeholder="Add weights, markings, questions, or next steps…"/></label>
   <div className="selling-photo-controls"><label>Add a photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={attach} disabled={busy||photoBusy}/></label><small>Up to 6 photos per case. JPEG, PNG, or WebP. Photos are resized and camera location metadata is removed. No identity documents or payment details.</small></div>
   {photoBusy&&<p role="status">Preparing photo…</p>}{draft.photo&&<div className="selling-photo-preview"><img src={'data:image/jpeg;base64,'+draft.photo} alt="Photo ready to send"/><button type="button" className="text-button" disabled={busy} onClick={()=>change({photo:null})}>Remove photo</button></div>}
   <button className="button button-gold" disabled={busy||photoBusy||loading||readOnlyPreview||(!draft.text.trim()&&!draft.photo)}>{busy?'Sending…':'Send to '+(admin?'seller':'buying desk')}</button>
  </form><small>Photos use temporary private links. Refresh the conversation if a link expires. Sending a photo does not authorize melting or commit either party to a sale.</small>
 </section>;
}
