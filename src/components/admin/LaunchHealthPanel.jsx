import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
export default function LaunchHealthPanel(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setBusy(true);setError('');try{
  const {data:auth}=await supabase.auth.getSession();
  const response=await fetch('/api/admin/launch-health',{headers:{authorization:`Bearer ${auth.session?.access_token || ''}`},signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Operational checks are unavailable.');setData(result);
 }catch(e){setError(e.message || 'Operational checks are unavailable.');}finally{setBusy(false);}}
 useEffect(()=>{load();},[]);
 const issues=data?[['Emails needing attention',Number(data.email_failed)+Number(data.email_overdue)],['Stuck card payments',Number(data.payment_stuck)+Number(data.payment_unbound)],['Payment reconciliation errors',Number(data.reconciliation_errors)]]:[];
 return <section className="admin-panel"><div className="panel-title"><div><h2>Operations checks</h2><p>Review failed notifications and unresolved payments before fulfilling orders.</p></div><button type="button" className="button button-outline" disabled={busy} onClick={load}>{busy?'Checking…':'Refresh checks'}</button></div>
 {error&&<div className="form-message error" role="alert">{error}</div>}
 {data&&<><div className="metric-grid">{issues.map(([label,count])=><article key={label}><div><small>{label}</small><b>{count}</b><em>{count?'Needs review':'No current alerts'}</em></div></article>)}</div>
 <p>Customer emails: <b>{data.email_enabled?'Enabled':'Disabled'}</b> · Provider-accepted notifications: <b>{data.email_accepted}</b> · Shipping fee: <b>${Number(data.shipping_flat).toFixed(2)}</b></p>
 <p>Card capture protection: <b>{data.manual_capture_enabled?'Enabled':'Awaiting isolated payment testing'}</b>. Required customer SMS: <b>{data.sms_required?'Enabled':'Disabled'}</b>.</p>
 <p className="muted">These checks do not certify launch readiness. Confirm tax setup, password-recovery MFA, backups and actual inbox delivery separately. A stuck payment must be reconciled with Stripe before clearing its payment hold.</p>
 <small>Checked {new Date(data.checked_at).toLocaleString()}</small></>}
 </section>;
}
