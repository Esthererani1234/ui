import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { requestReference, supportRequest } from '../../lib/supportRequests';
const fields='id,ticket_number,user_id,category,order_number,subject,message,status,admin_response,created_at,updated_at';
const labels={open:'Open',in_progress:'In progress',resolved:'Answered',closed:'Closed'};
export default function SupportAdminPanel() {
 const [tickets,setTickets]=useState([]),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[active,setActive]=useState(null);
 const [loading,setLoading]=useState(true),[hasMore,setHasMore]=useState(false),[notice,setNotice]=useState(null);
 const generation=useRef(0),references=useRef(new Map()),saving=useRef(false);
 const [drafts,setDrafts]=useState({}),[busy,setBusy]=useState(false);
 function referenceFor(id){if(!references.current.has(id))references.current.set(id,{current:null});return references.current.get(id);}
 function updateDraft(id,changes){setDrafts(current=>({...current,[id]:{...current[id],...changes}}));}
 async function load(append=false) {
  const version=++generation.current;setLoading(true);
  try {
   const offset=append?tickets.length:0;
   const {data,error}=await supabase.from('support_tickets').select(fields).order('updated_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49);
   if(error)throw error;
   if(version!==generation.current)return;
   setTickets(old=>append?[...new Map([...old,...(data || [])].map(t=>[t.id,t])).values()]:data || []);setHasMore(data?.length===50);setNotice(old=>old?.error?null:old);
  }catch{if(version===generation.current)setNotice({error:true,text:'Support tickets could not be loaded. Your last loaded conversations are still shown. Try Refresh tickets.'});}
  finally{if(version===generation.current)setLoading(false);}
 }
 useEffect(()=>{load();return()=>{generation.current++}},[]);
 const visible=tickets.filter(t=>(filter==='all'||(filter==='active'?!['resolved','closed'].includes(t.status):t.status===filter))&&`${t.ticket_number} ${t.subject} ${t.order_number || ''}`.toLowerCase().includes(search.toLowerCase().trim()));
 function saved(result) {
  setTickets(old=>old.map(t=>t.id===result.ticket.id?result.ticket:t).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)));
  setNotice({text:result.email_queued?'Ticket saved. Customer email notification queued.':result.email_enabled?'Ticket saved.':'Ticket saved. Email alerts are currently off; connect the sender in Security to enable them.'});
 }
 return <section className="admin-panel support-admin-panel"><div className="panel-title"><div><h2>Support tickets</h2><p>Read the conversation, reply to your customer, or update its status separately.</p></div><button type="button" className="button button-outline" disabled={loading} onClick={()=>load()}>Refresh tickets</button></div>
  <div className="support-admin-filters"><label>Search loaded tickets<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ticket, subject, or order number" /></label><label>Ticket status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All tickets</option><option value="active">Open & in progress</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
  {notice && <div className={`form-message ${notice.error?'error':'success'}`} role={notice.error?'alert':'status'}>{notice.text}</div>}
  {loading && <p role="status">Loading support tickets…</p>}
  <div className="admin-ticket-list">{visible.map(ticket=><article className="admin-ticket support-admin-ticket" key={ticket.id}><button className="support-thread-summary" aria-expanded={active===ticket.id} onClick={()=>setActive(active===ticket.id?null:ticket.id)}><div><small>{ticket.ticket_number} · {ticket.category}</small><h3>{ticket.subject}</h3><span>{ticket.order_number ? `Order ${ticket.order_number} · `:''}Updated {new Date(ticket.updated_at).toLocaleString()}</span></div><span className={`ticket-status ${ticket.status}`}>{labels[ticket.status]}</span></button>{active===ticket.id && <TicketConversation ticket={ticket} draft={drafts[ticket.id] || {}} onDraftChange={changes=>updateDraft(ticket.id,changes)} reference={referenceFor(ticket.id)} saving={saving} busy={busy} onBusyChange={setBusy} onSaved={saved} onRefresh={()=>load()} />}</article>)}</div>
  {!loading && !visible.length && <div className="empty-state compact"><h3>{tickets.length?'No matching tickets':'No support tickets yet'}</h3><p>{tickets.length?'Change the search or status filter.':'Customer requests will appear here.'}</p></div>}
  {hasMore && <button className="button button-outline" disabled={loading} onClick={()=>load(true)}>Load more tickets</button>}
 </section>;
}
function TicketConversation({ticket,draft,onDraftChange,reference,saving,busy,onBusyChange,onSaved,onRefresh}) {
 const [messages,setMessages]=useState([]),[notice,setNotice]=useState(null),[loading,setLoading]=useState(true),[messageError,setMessageError]=useState(false);
 const version=useRef(0);
 const reply=draft.reply || '',status=draft.status ?? ticket.status;
 const setReply=value=>onDraftChange({reply:value});
 const setStatus=value=>onDraftChange({status:value===ticket.status?null:value});
 async function loadMessages() {
  const current=++version.current;setLoading(true);
  try{const {data,error}=await supabase.from('support_ticket_messages').select('id,author_role,message,created_at').eq('ticket_id',ticket.id).order('created_at').order('id');if(error)throw error;if(current===version.current){setMessages(data || []);setMessageError(false);}}
  catch{if(current===version.current)setMessageError(true);}
  finally{if(current===version.current)setLoading(false);}
 }
 useEffect(()=>{loadMessages();return()=>{version.current++}},[ticket.id]);
 async function save(action) {
  if(saving.current || (action==='reply' && (loading || messageError)))return;
  if(action==='reply' && reply.trim().length<2)return setNotice({error:true,text:'Write at least two characters before sending.'});
  const body={action,ticket_id:ticket.id,status,expected_updated_at:ticket.updated_at,...(action==='reply'?{message:reply.trim()}:{})};
  saving.current=true;onBusyChange(true);setNotice(null);
  try{const result=await supportRequest({...body,request_id:requestReference(reference,body)});reference.current=null;onDraftChange({status:null,...(action==='reply'?{reply:''}:{})});onSaved(result);setNotice({text:action==='reply'?'Reply saved successfully.':'Status updated.'});await loadMessages();}
  catch(error){setNotice({error:true,text:error.message || 'The ticket could not be saved. Your draft is still here.'});}
  finally{saving.current=false;onBusyChange(false);}
 }
 return <div className="support-admin-conversation"><div className="panel-title"><h4>Conversation</h4><button type="button" className="text-button" disabled={busy||loading} onClick={async()=>{setNotice(null);await Promise.all([loadMessages(),onRefresh()]);}}>Refresh conversation</button></div>
  {loading && <p role="status">Loading messages…</p>}
  {messageError && <div className="form-message error" role="alert">The conversation could not be loaded. Refresh it before replying.</div>}
  <div className="admin-support-thread">{messages.length?messages.map(entry=><div className={`support-message ${entry.author_role}`} key={entry.id}><b>{entry.author_role==='admin'?'Gold On The Spot Support':'Customer'}</b><p>{entry.message}</p><small>{new Date(entry.created_at).toLocaleString()}</small></div>):!loading && !messageError && <div className="support-message customer"><b>Customer’s original request</b><p>{ticket.message}</p></div>}</div>
  <label>Ticket status to save<select value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  <label>Reply to customer<textarea disabled={busy} rows={5} maxLength={5000} value={reply} onChange={e=>setReply(e.target.value)} placeholder="Write your response. It will appear in the customer’s private support conversation." /></label>
  {notice && <div className={`form-message ${notice.error?'error':'success'}`} role={notice.error?'alert':'status'}>{notice.text}</div>}
  <div className="admin-ticket-actions"><button className="button button-dark" disabled={busy||loading||messageError||reply.trim().length<2} onClick={()=>save('reply')}>{busy?'Saving…':'Send reply & save status'}</button><button className="button button-outline" disabled={busy||status===ticket.status} onClick={()=>save('status')}>Save status only</button></div>
 </div>;
}
