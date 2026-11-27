import AddressPreview from '../checkout/AddressPreview';
import {useEffect,useState} from 'react';
import states from '../../../shared/taxSources.json';
import {supabase} from '../../lib/supabase';
import './taxCompliance.css';

const currency=n=>n==null?'—':(Number(n)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
async function adminRequest(query,body){
  const {data}=await supabase.auth.getSession();
  const res=await fetch('/api/admin/tax'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+(data.session?.access_token||''),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(!res.ok)throw Error((await res.json().catch(()=>({}))).error||'Compliance data is unavailable.');
  return query.includes('format=csv')?res.blob():res.json();
}
const fields={
 schedule:['starts','ends','due'],file:['id','filed','confirmation','reported'],remit:['id','paid_on','payment_method','payment_reference','paid'],
 refund:['order','reference','date','merchandise','taxable','exempt','components'],
 external:['reference','date','channel','merchandise','taxable','exempt','tax'],
};
const labels={order:'Order ID',components:'Confirmed refund tax components (JSON cents by code)',id:'Filing ID',starts:'Period start',ends:'Period end',due:'Due date',filed:'Actual filing date',reported:'Amount reported (cents)',confirmation:'Filing confirmation number',paid_on:'Actual payment date',paid:'Amount paid (cents)',payment_method:'Payment method',payment_reference:'Payment confirmation',reference:'External transaction ID',date:'Sale date',merchandise:'Merchandise (cents)',taxable:'Taxable (cents)',exempt:'Exempt (cents)',tax:'Tax collected by this business (cents)',channel:'Sales channel'};
function StateControls({row,save,profile,filings}){
  const [action,setAction]=useState('settings'),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [versionType,setType]=useState('policy');
  const typeOptions={policy:'State treatment',address:'Full address and rates',product:'Product classification',nexus:'Economic nexus'};
  const submit=async e=>{
    e.preventDefault();const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));setPending(true);setError('');
    try{
      if(action==='evidence'){
        const file=values.upload;
        if(!file || !file.size || file.size>2097152)throw Error('Choose a PDF or image up to 2 MB.');
        const contents=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('File read failed.'));r.readAsDataURL(file);});
        values.base64=contents.split(',')[1];values.name=file.name;delete values.upload;
      }
      if(action==='settings')values.disabled=values.disabled==='on';
      if(action==='version'){values.data=JSON.parse(values.payload);delete values.payload;}
      await save(action,values);setError('Saved.');
    }catch(err){setError(err.message);}finally{setPending(false);}
  };
  return <><h3>Administration</h3><label>Action<select value={action} onChange={e=>{setAction(e.target.value);setError('');}}>{Object.entries({settings:'Registration and shipping',schedule:'Schedule a filing',file:'Record a filed return',remit:'Record an actual payment',external:'Import an external sale',refund:'Record a confirmed refund',evidence:'Upload a permit or confirmation',version:'Record a reviewed rule'}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <form className="tax-fields" onSubmit={submit} key={row.code+action}>
      {action==='settings'&&<><label>Registration<select name="registration" defaultValue={row.registration}>{['Requires Legal Review','Not Registered','No Current Obligation','Registration Required','Registration Pending','Registered'].map(v=><option key={v}>{v}</option>)}</select></label>
      {Object.entries({effective:'Registration effective',registration_due:'Registration deadline',collect_from:'Collect beginning'}).map(([k,v])=><label key={k}>{v}<input type="date" name={k} defaultValue={row[k]||''}/></label>)}
      <label>Assigned filing frequency<input name="frequency" defaultValue={row.frequency||''}/></label><label>Admin notes<textarea name="note" defaultValue={row.note||''}/></label><label><input type="checkbox" name="disabled" defaultChecked={row.disabled}/> Disable orders to this state</label></>}
      {action==='evidence'&&<><label>Document type<select name="kind">{['permit','filing','payment','exemption'].map(k=><option key={k}>{k}</option>)}</select></label><label>PDF or image up to 2 MB<input type="file" name="upload" required accept="application/pdf,image/png,image/jpeg"/></label></>}
      {fields[action]?.map(k=><label key={k}>{labels[k]}{k==='channel'?<select name={k}><option value="external_direct">External direct</option><option value="marketplace">Marketplace</option></select>:<input required name={k} type={['starts','ends','due','filed','paid_on','date'].includes(k)?'date':['id','reported','paid','merchandise','taxable','exempt','tax'].includes(k)?'number':'text'} min="0"/>}</label>)}
      {action==='version'&&<><label>Rule category<select name="kind" value={versionType} onChange={e=>setType(e.target.value)}>{Object.entries(typeOptions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
       <label>{versionType==='product'?'Product ID':versionType==='address'?'Verified full address (JSON)':'Scope'}<input name="subject" key={versionType} required defaultValue={['policy','nexus'].includes(versionType)?'state':''}/></label>
       <label>Government source<select required name="source">{row.sources.map(s=><option key={s.url} value={s.url}>{s.title}</option>)}</select></label>
       {Object.entries({verified:'Verification date',start:'Effective date',end:'Review valid through'}).map(([k,label])=><label key={k}>{label}<input name={k} type="date" required/></label>)}
       <label>Approval<select name="approval"><option value="requires_review">Requires review</option><option value="approved">Approve this version</option></select></label>
       <label>Reviewed rule fields (JSON)<textarea required name="payload" rows="5"/></label></>}
      <button type="submit" className="button button-dark" disabled={pending}>{pending?'Saving…':'Save record'}</button>
      {error&&<p role="status">{error}</p>}
    </form>
    {profile?.documents?.length>0&&<><h3>Protected documents</h3>{profile.documents.map(d=><button className="text-button" key={d.id} onClick={async()=>{try{const r=await adminRequest('?state='+row.code+'&document='+d.id);window.location.assign(r.url);}catch(e){setError(e.message);}}}>{d.name} · {d.kind}</button>)}</>}
    <h3>Filing history</h3>{filings.length?filings.map(f=><p key={f.id}>#{f.id} · {f.starts} through {f.ends} · Due {f.due} · {f.filed?'Filed '+f.filed:'Open'} · {f.paid==null?'Payment unconfirmed':currency(f.paid)+' paid'}</p>):<p>No filing periods recorded.</p>}
    {profile?.rules?.length>0&&<details><summary>Reviewed rule versions ({profile.rules.length})</summary>{profile.rules.map(r=><p key={r.id}>{r.kind} · {r.approval} · {r.valid_from} through {r.valid_until}</p>)}</details>}
  </>;
}
function PreviewCalculator(){
  const [state,setState]=useState('NY'),[amount,setAmount]=useState('750.00');
  const [address,setAddress]=useState({address_line_1:'',address_line_2:'',city:'',postal_code:''});
  const [response,setResponse]=useState(null),[attempt,retry]=useState(0);
  const streetMode=['WA','NM','VT','HI'].includes(state);
  const cents=/^\d+(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0;
  const destination={...address,state,country:'US'};
  const ready=cents>0 && cents<=100000000 && (!streetMode || (address.address_line_1.trim() && address.city.trim() && /^\d{5}(-\d{4})?$/.test(address.postal_code)));
  const key=JSON.stringify(streetMode?{mode:'street_order',address:destination,cents}:{state,cents});
  useEffect(()=>{
    if(!ready)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const url=streetMode?'/api/checkout/tax':'/api/checkout/tax?'+new URLSearchParams(JSON.parse(key));
        const options=streetMode?{method:'POST',headers:{'content-type':'application/json'},body:key}:{};
        const r=await fetch(url,{...options,signal:controller.signal,cache:'no-store'});
        const value=await r.json();
        if(!controller.signal.aborted)setResponse({key,attempt,value:r.ok?value:{status:'unavailable',message:value.error || 'Tax lookup is unavailable.'}});
      } catch {
        if(!controller.signal.aborted)setResponse({key,attempt,value:{status:'unavailable',message:'Tax lookup is temporarily unavailable.'}});
      }
    },streetMode?650:250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[ready,key,attempt,streetMode]);
  const out=ready && response?.key===key && response.attempt===attempt?response.value:null;
  const examples={NY:'New York',CA:'California',CT:'Connecticut',MA:'Massachusetts',MD:'Maryland',WA:'Washington',ME:'Maine',VT:'Vermont',DC:'Washington, DC',HI:'Hawaii',NM:'New Mexico'};
  return <details open id="checkout-example"><summary>Try a sample order</summary>
    <p>One gold bar paid by wire. Taxable examples assume a registered seller. Hawaii and New Mexico illustrate passing the seller tax on to the buyer.</p>
    <p><a href="/api/checkout/tax?format=locations" download>Download Washington, New Mexico, Vermont and Hawaii rates (CSV)</a></p>
    <div className="tax-fields"><label>Destination<select value={state} onChange={e=>{setState(e.target.value);setAddress({address_line_1:'',address_line_2:'',city:'',postal_code:''});}}>{Object.entries(examples).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
    {streetMode && Object.entries({address_line_1:'Delivery street address',address_line_2:'Apartment or suite (optional)',city:'City',postal_code:'ZIP code'}).map(([field,label])=><label key={field}>{label}<input value={address[field]} maxLength={field==='postal_code'?10:160} onChange={e=>setAddress({...address,[field]:e.target.value})}/></label>)}
    <label>Purchase amount ($)<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/></label></div>
    <div aria-live="polite">{ready && !out && <p>Checking tax…</p>}
    {out?.status==='suggestion' && <p>Use {out.address.address_line_1}, {out.address.city}, {out.address.state} {out.address.postal_code}? <button type="button" className="text-button" onClick={()=>{if(out.address.state!==state)return;setAddress(out.address);}}>Use this address</button></p>}
    {out?.message && <p>{out.message} {out.status==='unavailable'&&<button type="button" className="text-button" onClick={()=>retry(n=>n+1)}>Try again</button>}</p>}
    {out?.location && <p>{out.location}</p>}
    {out?.tax>0 && <p>Tax <strong>{currency(out.tax)}</strong></p>}
    {out?.total!=null && <p>Total <strong>{currency(out.total)}</strong></p>}</div></details>;
}
export default function TaxCompliance({researchOnly=false}){
  const [filter,setFilter]=useState(''),[selected,select]=useState(null),[data,setData]=useState(null),[profile,setProfile]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [from,setFrom]=useState(today().slice(0,4)+'-01-01'),[to,setTo]=useState(today());
  useEffect(()=>{if(researchOnly)return;let live=true;setError('');setData(null);adminRequest('?from='+from+'&to='+to).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[researchOnly,from,to,refresh]);
  useEffect(()=>{let live=true;setProfile(null);if(selected&&!researchOnly)adminRequest('?state='+selected+'&from='+from+'&to='+to).then(d=>{if(live)setProfile(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[selected,researchOnly,from,to,refresh]);
  const rows=states.map(r=>({...r,...data?.states?.find(s=>s.state===r.code)})),row=rows.find(r=>r.code===selected);
  const aggregate=k=>data?.states.reduce((n,s)=>n+Number(s.period?.[k]||0),0);
  const exportReport=async()=>{try{const blob=await adminRequest('?format=csv&state='+selected+'&from='+from+'&to='+to);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=selected+'-tax-'+from+'-'+to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(e){setError(e.message);}};
  return <section className="admin-panel tax-workspace">
    <header><h2>{researchOnly?'State tax research':'Sales Tax & Compliance'}</h2><p>{researchOnly?'Official sources and review status for all 50 states and Washington, DC.':'Review obligations, sales, filings and payment confirmations.'}</p></header>
    {researchOnly&&<><AddressPreview/><PreviewCalculator/></>}
    {!researchOnly&&<div className="tax-period"><label>Period start<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Period end<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}
    {error&&<p className="form-message error" role="alert">{error}</p>}
    {data&&<><div className="metric-grid">{Object.entries({merchandise:'Recorded sales',taxable:'Taxable merchandise',exempt:'Exempt merchandise',tax:'Tax collected',remitted:'Remitted'}).map(([k,v])=><article key={k}><small>{v}</small><b>{currency(aggregate(k))}</b></article>)}</div>
    <p>Net tax movement this period: {currency(aggregate('tax')-aggregate('remitted'))}. Older paid orders awaiting tax reconciliation: {data.legacy_orders}.</p>
    {data.alerts?.length>0&&<details><summary>Compliance alerts ({data.alerts.length})</summary>{data.alerts.map(a=><p key={a.event_key}>{a.state} · {a.message} {a.source && <a href={a.source} target="_blank" rel="noreferrer">State guidance</a>}</p>)}</details>}</>}
    {row?<><button className="text-button" onClick={()=>select(null)}>← All jurisdictions</button><h3>{row.name}</h3>
      <p>{row.finding||'Product treatment awaits verification.'}</p><p>Source research {row.researchDate} · {row.effectiveFrom?'Source provision effective '+row.effectiveFrom+' · ':''}Checkout approval requires separate review.</p>
      {profile?.components?.length>0 && <details><summary>Tax by jurisdiction for this period</summary><table><thead><tr><th>Jurisdiction</th><th>Rate</th><th>Net tax</th></tr></thead><tbody>
        {profile.components.map((c,i)=><tr key={i}><td>{[c.name || c.code,c.county,c.districts?.join(', ')].filter(Boolean).join(' · ')}</td><td>{Number(c.ppm)/10000}%</td><td>{currency(c.cents)}</td></tr>)}
      </tbody></table></details>}
      {profile?.nexus&&<p>Nexus threshold reached: {profile.nexus.percentage}% · {profile.nexus.reached?'Registration review due':'Monitoring'}</p>}
      <h3>Government sources</h3><ul>{row.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title||s.url}</a> <small>{s.purpose}</small></li>)}</ul>
      {data&&<><button className="button button-outline" onClick={exportReport}>Download period ledger (CSV)</button><StateControls key={row.code} row={row} profile={profile} filings={data.filings.filter(f=>f.state===row.code)} save={async(action,values)=>{await adminRequest('',{state:row.code,action,data:values});setRefresh(i=>i+1);}}/></>}
    </>:<><label>Find a jurisdiction<input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="State name or abbreviation"/></label>
    {!researchOnly && <p>¹ Website receipts include paid and refunded orders before refund adjustments. They are a screening amount for registration review.</p>}
    <div className="tax-table"><table><thead><tr><th>Jurisdiction</th><th>Research</th>{!researchOnly&&<><th>Registration</th><th>Website orders</th><th>Website receipts¹</th><th>Recorded sales</th><th>Collected</th></>}</tr></thead>
    <tbody>{rows.filter(r=>(r.name+' '+r.code).toLowerCase().includes(filter.toLowerCase())).map(r=><tr key={r.code}><th><button className="text-button" onClick={()=>select(r.code)}>{r.name}</button></th><td>{r.finding?'Research note available':'Requires legal review'}</td>{!researchOnly&&<><td>{r.disabled?'Shipping Disabled':r.registration||'Awaiting data'}</td><td>{r.website_orders ?? "—"}</td><td>{r.website_receipts == null ? "—" : currency(r.website_receipts)}</td><td>{currency(r.period?.merchandise)}</td><td>{currency(r.period?.tax)}</td></>}</tr>)}</tbody></table></div></>}
  </section>;
}
