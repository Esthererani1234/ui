import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ClipboardList, Mail, Phone, RefreshCw, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeFunction } from '../../lib/functionRequest';
import '../../styles/sellAdmin.css';

const labels={new:'New',reviewing:'In review',contacted:'Contacted',quoted:'Quoted',closed:'Closed'};
const descriptions={new:'A new enquiry is ready for your attention.',reviewing:'Review the items and decide what information you need next.',contacted:'You have contacted the seller. Record the next step in your notes.',quoted:'An offer has been discussed. Keep its details and any follow-up in your notes.',closed:'This case is closed. Reopen it for review if the seller returns.'};
const request=body=>invokeFunction(supabase,'sell-requests',body,{timeout:25000});
const date=value=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const initials=name=>name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
export default function SellAdminPanel(){
 const [items,setItems]=useState([]),[drafts,setDrafts]=useState({}),[filter,setFilter]=useState('all'),[search,setSearch]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[more,setMore]=useState(false),[notice,setNotice]=useState(null);
 const [selectedId,setSelectedId]=useState(null),[mobileDetail,setMobileDetail]=useState(false);
 const generation=useRef(0),saving=useRef(false),detailHeading=useRef(null);
 async function load(append=false){
  const version=++generation.current;setLoading(true);
  try{const result=await request({action:'list',offset:append?items.length:0});if(version!==generation.current)return;setItems(old=>append?[...new Map([...old,...result.requests].map(item=>[item.id,item])).values()]:result.requests);setMore(result.has_more);setNotice(null);}
  catch{if(version===generation.current)setNotice({error:true,text:'Cases could not be loaded. Refresh to try again. Your notes and unsaved changes are kept.'});}
  finally{if(version===generation.current)setLoading(false);}
 }
 useEffect(()=>{load();return()=>{generation.current++}},[]);
 const visible=items.filter(item=>(filter==='all'||item.status===filter)&&[item.reference,item.name,item.email,item.phone,item.message].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 const selected=visible.find(item=>item.id===selectedId)||visible[0]||null;
 const dirty=item=>!!item && ((drafts[item.id]?.status??item.status)!==item.status || (drafts[item.id]?.notes??item.internal_notes)!==item.internal_notes);
 const dirtyCount=items.filter(dirty).length;
 const counts=Object.fromEntries(Object.keys(labels).map(status=>[status,items.filter(item=>item.status===status).length]));
 function draft(id,changes){setDrafts(old=>({...old,[id]:{...old[id],...changes}}));}
 function select(item){setSelectedId(item.id);setMobileDetail(true);setNotice(null);requestAnimationFrame(()=>{detailHeading.current?.focus({preventScroll:true});if(window.matchMedia('(max-width: 900px)').matches)detailHeading.current?.scrollIntoView({block:'start'});});}
 function filterBy(value){setFilter(value);setMobileDetail(false);setNotice(null);}
 useEffect(()=>{if(!dirtyCount)return;const warn=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirtyCount]);
 async function save(item,statusOverride){
  if(saving.current||loading)return;
  saving.current=true;setBusy(true);setNotice(null);
  try{const result=await request({action:'update',id:item.id,version:item.version,status:statusOverride??drafts[item.id]?.status??item.status,internal_notes:drafts[item.id]?.notes??item.internal_notes});
   setItems(old=>old.map(row=>row.id===item.id?result.request:row));setSelectedId(item.id);setDrafts(old=>{const next={...old};delete next[item.id];return next;});setNotice({text:'Saved '+item.name+'’s case. Status: '+labels[result.request.status]+'.'});
   if(filter!=='all'&&filter!==result.request.status)setFilter('all');
  }catch(e){setNotice({error:true,text:e.message || 'The case could not be saved. Your draft is kept.'});}
  finally{saving.current=false;setBusy(false);}
 }
 return <section className="sell-desk" aria-label="Selling Centre administration">
  <header className="sell-desk-heading"><div><span className="sell-desk-eyebrow">PRECIOUS METALS · BUYING DESK</span><h2>Your buying desk</h2><p>Review items, follow up with sellers, and move each case forward.</p></div><button className="button button-outline" disabled={loading||busy} onClick={()=>load()}><RefreshCw size={16}/>{loading?'Refreshing…':'Refresh cases'}</button></header>
  <div className="sell-desk-stats" aria-label="Loaded case overview"><div><span>New enquiries</span><strong>{counts.new}</strong><small>Ready for your review</small></div><div><span>In progress</span><strong>{counts.reviewing+counts.contacted}</strong><small>Reviewing or following up</small></div><div><span>Offers discussed</span><strong>{counts.quoted}</strong><small>Cases marked quoted</small></div><div><span>Closed</span><strong>{counts.closed}</strong><small>Completed reviews</small></div></div>
  <div className="sell-desk-toolbar"><label className="sell-desk-search"><Search size={18}/><span className="sell-desk-sr">Search selling cases</span><input value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setMobileDetail(false);}} placeholder="Search seller, email, phone, items or reference"/></label><span>{items.length} cases loaded{more?' · more available':''}{dirtyCount?' · '+dirtyCount+' unsaved':''}</span></div>
  <div className="sell-desk-filters" aria-label="Filter by case status"><button disabled={busy} aria-pressed={filter==='all'} onClick={()=>filterBy('all')}>All cases <span>{items.length}</span></button>{Object.entries(labels).map(([key,label])=><button disabled={busy} key={key} aria-pressed={filter===key} onClick={()=>filterBy(key)}>{label}<span>{counts[key]}</span></button>)}</div>
  {notice&&<div className={'form-message '+(notice.error?'error':'success')} role={notice.error?'alert':'status'}>{notice.text}{notice.error&&<button className="text-button" disabled={loading||busy} onClick={()=>load()}>Refresh cases</button>}</div>}
  {loading&&<p className="sell-desk-loading" role="status">Loading selling cases…</p>}
  <div className={'sell-desk-workspace'+(mobileDetail?' showing-detail':'')}>
   <aside className="sell-desk-inbox" aria-label="Selling case list"><div className="sell-desk-list-heading"><b>{filter==='all'?'Case inbox':labels[filter]}</b><span>{visible.length} shown</span></div>
    {visible.map(item=><button className={'sell-desk-row'+(selected?.id===item.id?' selected':'')} key={item.id} disabled={busy} aria-pressed={selected?.id===item.id} onClick={()=>select(item)}><span className="sell-desk-row-top"><b>{item.name}</b><span className={'sell-desk-badge '+item.status}>{labels[item.status]}</span></span><span className="sell-desk-preview">{item.message}</span><span className="sell-desk-row-bottom"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time><span>{dirty(item)?'Unsaved changes':item.reference.slice(0,13)+'…'}</span></span></button>)}
    {!loading&&!visible.length&&<div className="sell-desk-empty"><ClipboardList size={30}/><h3>{items.length?'No matching cases':'Your inbox is ready'}</h3><p>{items.length?'Change the search or choose another status.':'New selling cases will appear here when customers submit their items.'}</p>{items.length>0&&<button className="text-button" onClick={()=>{setSearch('');filterBy('all');}}>Clear filters</button>}</div>}
    {more&&<button className="button button-outline sell-desk-more" disabled={loading||busy} onClick={()=>load(true)}>Load more cases</button>}
   </aside>
   <div className="sell-desk-detail">{selected?<>
    <button className="sell-desk-back text-button" disabled={busy} onClick={()=>setMobileDetail(false)}><ArrowLeft size={16}/> Back to cases</button>
    <header className="sell-desk-case-heading"><span className="sell-desk-avatar" aria-hidden="true">{initials(selected.name)}</span><div><span className="sell-desk-eyebrow">SELLING CASE</span><h3 ref={detailHeading} tabIndex={-1}>{selected.name}</h3><span className="sell-desk-reference">{selected.reference}</span></div><span className={'sell-desk-badge '+selected.status}>{labels[selected.status]}</span></header>
    <div className="sell-desk-contact"><a href={'mailto:'+encodeURIComponent(selected.email)+'?subject='+encodeURIComponent('Your selling case '+selected.reference)}><Mail size={17}/><span><small>Email seller</small>{selected.email}</span><ArrowUpRight size={15}/></a><a href={'tel:'+selected.phone.replace(/[^+\d]/g,'')}><Phone size={17}/><span><small>Call seller</small>{selected.phone}</span><ArrowUpRight size={15}/></a></div>
    <section className="sell-desk-items"><h4>What they want to sell</h4><p>{selected.message}</p><small>Received {date(selected.created_at)}</small></section>
    <section className="sell-desk-progress"><div><h4>Move this case forward</h4><p>{descriptions[selected.status]}</p></div><label>Review status<select disabled={busy} value={drafts[selected.id]?.status??selected.status} onChange={e=>draft(selected.id,{status:e.target.value})}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{selected.status==='new'&&!dirty(selected)&&<button className="button button-outline" disabled={loading||busy} onClick={()=>save(selected,'reviewing')}>Start review</button>}{selected.status==='closed'&&!dirty(selected)&&<button className="button button-outline" disabled={loading||busy} onClick={()=>save(selected,'reviewing')}>Reopen for review</button>}</section>
    <section className="sell-desk-notes"><label htmlFor="selling-case-notes">Internal case notes</label><p>Record weights, purity, pricing discussed, and the next action. These notes stay private.</p><textarea id="selling-case-notes" disabled={busy} rows={7} maxLength={5000} value={drafts[selected.id]?.notes??selected.internal_notes} onChange={e=>draft(selected.id,{notes:e.target.value})} placeholder={'Items / weight / purity\nOffer discussed\nNext action and follow-up'}/><small>{(drafts[selected.id]?.notes??selected.internal_notes).length}/5,000 characters · Contact the seller using Email seller or Call seller above.</small></section>
    <footer className="sell-desk-save"><div>{dirty(selected)?<b>Unsaved changes</b>:<span><Check size={15}/> All changes saved</span>}<small>Last updated {date(selected.updated_at)}</small></div><button className="button button-gold" disabled={busy||loading||!dirty(selected)} onClick={()=>save(selected)}>{busy?'Saving…':'Save changes'}</button></footer>
   </>:<div className="sell-desk-empty sell-desk-detail-empty"><ClipboardList size={42}/><h3>A clear view of every case.</h3><p>Select a case to review the seller’s items, contact them, and manage the next steps.</p></div>}</div>
  </div>
 </section>;
}
