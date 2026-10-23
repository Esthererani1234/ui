import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { invokeFunction } from '../../lib/functionRequest';
import '../../styles/sellPortal.css';
const labels={new:'New',reviewing:'In review',contacted:'Contacted',quoted:'Quoted',closed:'Closed'};
const request=body=>invokeFunction(supabase,'sell-requests',body,{timeout:25000});
export default function SellAdminPanel(){
 const [items,setItems]=useState([]),[drafts,setDrafts]=useState({}),[filter,setFilter]=useState('all'),[search,setSearch]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[more,setMore]=useState(false),[notice,setNotice]=useState(null);
 const generation=useRef(0),saving=useRef(false);
 async function load(append=false){const version=++generation.current;setLoading(true);try{const result=await request({action:'list',offset:append?items.length:0});if(version!==generation.current)return;setItems(old=>append?[...new Map([...old,...result.requests].map(item=>[item.id,item])).values()]:result.requests);setMore(result.has_more);setNotice(null);}catch{if(version===generation.current)setNotice({error:true,text:'Sell requests could not be loaded. Try Refresh requests. Your drafts are kept.'});}finally{if(version===generation.current)setLoading(false);}}
 useEffect(()=>{load();return()=>{generation.current++}},[]);
 function draft(id,changes){setDrafts(old=>({...old,[id]:{...old[id],...changes}}));}
 async function save(item){if(saving.current)return;saving.current=true;setBusy(true);setNotice(null);try{const result=await request({action:'update',id:item.id,version:item.version,status:drafts[item.id]?.status??item.status,internal_notes:drafts[item.id]?.notes??item.internal_notes});setItems(old=>old.map(row=>row.id===item.id?result.request:row));setDrafts(old=>{const next={...old};delete next[item.id];return next;});setNotice({text:'Request saved. Notes are internal; contact the seller by email or phone to follow up.'});}catch(e){setNotice({error:true,text:e.message});}finally{saving.current=false;setBusy(false);}}
 const visible=items.filter(item=>(filter==='all'||item.status===filter)&&`${item.reference} ${item.name} ${item.email}`.toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="admin-panel sell-admin-panel"><div className="panel-title"><div><h2>Sell requests</h2><p>Your dedicated precious-metals buying inbox—separate from customer support.</p></div><button className="button button-outline" disabled={loading||busy} onClick={()=>load()}>Refresh requests</button></div>
 <div className="support-admin-filters"><label>Search loaded requests<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, email, or reference"/></label><label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All requests</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
 {notice&&<div className={`form-message ${notice.error?'error':'success'}`} role={notice.error?'alert':'status'}>{notice.text}</div>}
 {loading&&<p role="status">Loading sell requests…</p>}
 {visible.map(item=><details className="sell-admin-card" key={item.id}><summary><b>{item.name}</b><span>{labels[item.status]} · {new Date(item.created_at).toLocaleString()}</span></summary><p className="sell-admin-reference">{item.reference}</p><div className="sell-admin-contact"><a href={`mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(`Your sell request ${item.reference}`)}`}>{item.email}</a><a href={`tel:${item.phone.replace(/[^+\d]/g,'')}`}>{item.phone}</a></div><h4>Items to evaluate</h4><p>{item.message}</p><label>Review status<select disabled={busy} value={drafts[item.id]?.status??item.status} onChange={e=>draft(item.id,{status:e.target.value})}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Internal notes—not sent to the seller<textarea disabled={busy} rows={4} maxLength={5000} value={drafts[item.id]?.notes??item.internal_notes} onChange={e=>draft(item.id,{notes:e.target.value})}/></label><button className="button button-dark" disabled={busy||loading} onClick={()=>save(item)}>{busy?'Saving…':'Save request'}</button></details>)}
 {!loading&&!visible.length&&<div className="empty-state compact"><h3>{items.length?'No matching requests':'No sell requests yet'}</h3><p>{items.length?'Change your search or status filter.':'Requests submitted through Sell to us will appear here.'}</p></div>}
 {more&&<button className="button button-outline" disabled={loading||busy} onClick={()=>load(true)}>Load more requests</button>}
 </section>;
}
