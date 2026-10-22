import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
async function request(body) {
 const {data}=await supabase.auth.getSession();
 const response=await fetch('/api/admin/order-emails',{method:body?'POST':'GET',headers:{authorization:`Bearer ${data.session?.access_token || ''}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok) throw new Error(result.error || 'Order email settings could not be loaded.');
 return result;
}
export default function OrderEmailPanel() {
 const [settings,setSettings]=useState(null),[form,setForm]=useState({api_key:'',from_email:'orders@goldonthespot.com',reply_to:'support@goldonthespot.com',reason:''});
 const [event,setEvent]=useState('paid'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null);
 const saving=useRef(false);
 async function load() {
  const result=await request();setSettings(result);
  setForm(f=>({...f,from_email:result.from_email,reply_to:result.reply_to}));
 }
 useEffect(()=>{load().catch(error=>setNotice({error:true,text:error.message}));},[]);
 async function act(action) {
  if(saving.current)return;saving.current=true;setBusy(true);setNotice(null);
  try {
   const result=await request(action==='connect'?{action,...form,event}:action==='pause'?{action,reason:form.reason}:{action,event});
   setForm(f=>({...f,api_key:'',reason:''}));setNotice({text:result.message});
   try{await load();}catch{setNotice({text:result.message+' Refresh settings to see the latest delivery activity.'});}
  }catch(error){setNotice({error:true,text:error.message});}
  finally{saving.current=false;setBusy(false);}
 }
 return <section className="admin-panel order-email-panel" aria-labelledby="order-email-heading">
  <div className="panel-title"><div><h2 id="order-email-heading">Customer order emails</h2><p>Branded receipts and updates for payment, preparation, shipping, delivery, cancellation, and refunds.</p></div><span className={`status-pill ${settings?.enabled?'completed':''}`}>{settings?.enabled?'Enabled':settings?.configured?'Paused':'Needs connection'}</span></div>
  <p>Each email includes product photos, quantities, totals, and a secure order link. Shipment updates include tracking. Your account-verification emails stay separate.</p>
  {notice && <div className={`form-message ${notice.error?'error':'success'}`} role={notice.error?'alert':'status'}>{notice.text}</div>}
  {!settings ? <button type="button" className="button button-outline" onClick={()=>load().catch(error=>setNotice({error:true,text:error.message}))}>Reload email settings</button> : <>
   <form onSubmit={e=>{e.preventDefault();act('connect');}}>
    <div className="form-row"><label>Resend sending API key<input type="password" autoComplete="new-password" spellCheck="false" value={form.api_key} onChange={e=>setForm({...form,api_key:e.target.value})} placeholder={settings.configured?`Saved securely ••••${settings.key_last4}`:'re_…'} maxLength={210} /><small>{settings.configured?'Leave blank to keep the saved key.':'Use a sending key for your verified goldonthespot.com domain.'} The key is encrypted and never returned to the browser.</small></label></div>
    <div className="form-row"><label>Sender email<input type="email" required value={form.from_email} onChange={e=>setForm({...form,from_email:e.target.value})} /></label><label>Customer reply-to email<input type="email" required value={form.reply_to} onChange={e=>setForm({...form,reply_to:e.target.value})} /></label></div>
    <label>Reason for this change<input required minLength={3} maxLength={1000} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="Enable branded order updates" /></label>
    <div className="order-email-buttons"><button className="button button-dark" disabled={busy}>{busy?'Working…':'Connect & send sample to me'}</button>{settings.enabled && <button type="button" className="button button-outline" disabled={busy} onClick={()=>act('pause')}>Pause order emails</button>}</div>
    <small>Connecting sends one sample to your verified admin email, then enables future order updates. Existing orders will not receive old notifications.</small>
   </form>
   {settings.configured && <div className="order-email-samples"><label>Preview an email<select value={event} onChange={e=>setEvent(e.target.value)}>{settings.events.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button type="button" className="button button-outline" disabled={busy} onClick={()=>act('test')}>Send sample to me</button></div>}
   <div className="panel-title"><h3>Recent email activity</h3><button type="button" className="text-button" disabled={busy} onClick={()=>load().catch(error=>setNotice({error:true,text:error.message}))}>Refresh activity</button></div>
   <p className="muted">Sent means accepted by the email provider. Check Resend for inbox delivery or bounce details.</p>
   <div className="order-email-activity">{settings.recent.length?settings.recent.map(row=><article key={row.id}><div><b>{row.order_number}</b><span>{settings.events.find(e=>e.value===row.event_type)?.label || row.event_type}</span></div><div><b>{({sent:'Sent',pending:'Queued',sending:'Sending',failed:'Needs attention',skipped:'Superseded / expired'})[row.status] || row.status}</b><small>{new Date(row.sent_at || row.created_at).toLocaleString()}</small>{row.status==='failed' && <small>Check your sender connection and Resend delivery log. An uncertain send is not automatically resent after its safe retry window.</small>}</div></article>):<p>No order emails yet.</p>}</div>
  </>}
 </section>;
}
