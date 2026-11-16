import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {deliveryMethods,deliveryStates,acknowledgment,serialAcknowledgment,timeLabel,money,unitText} from '../../shared/deliveryDocs.js';
import './orderDocuments.css';
const captions={invoice:'Invoice',packing:'Packing slip',ack:'Delivery acknowledgment',signed:'Signed acknowledgment'};
const blank={serial:'',manufacturer:'',assay:'',weight:'',purity:''};
async function request(order,action,data,revision){
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Sign in again.');
 const response=await fetch('/api/payments/order-documents',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({order,action,data,revision}),cache:'no-store'});
 if(!response.ok)throw Error((await response.json().catch(()=>null))?.error||'Request failed. Please try again.');
 return /application\/(pdf|zip)/.test(response.headers.get('Content-Type'))?response.blob():response.json()
}
function download(blob,name){const url=URL.createObjectURL(blob),el=document.createElement('a');el.href=url;el.download=name;el.click();setTimeout(()=>URL.revokeObjectURL(url),90000)}
const localDate=v=>{if(!v)return '';const date=new Date(v);return new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16)};
export default function OrderDocuments({orderId}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[tag,setTag]=useState(blank),[line,setLine]=useState(0),[slot,setSlot]=useState(1),[delivery,setDelivery]=useState({}),[photo,setPhoto]=useState(false),[sign,setSign]=useState(false),[pdf,setPdf]=useState(null);
 const uploader=useRef(),lock=useRef(false);
 async function refresh(){const r=await request(orderId,'load');setData(r);return r}
 useEffect(()=>{let alive=true;request(orderId,'load').then(r=>{if(alive)setData(r)}).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[orderId]);
 const state=data?.state,items=state?.items||[],item=items.find(i=>i.id===line)||items[0],unit=item?.units.find(u=>u.unit===slot);
 useEffect(()=>{setTag({...blank,...unit})},[unit,line,slot]);
 useEffect(()=>{if(state)setDelivery({method:'',status:'Pending',representative:'',recipient:'',notes:'',carrier:'',tracking:state.order.tracking_number||'',...state.delivery,actual:localDate(state.delivery.actual)})},[state]);
 useEffect(()=>()=>{if(pdf)URL.revokeObjectURL(pdf.url)},[pdf]);
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNote('');try{await fn()}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}}
 const call=(a,v)=>request(orderId,a,v,data?.revision);
 async function save(a,v){await call(a,v);await refresh();setNote('Saved to this order.')}
 function print(kind,record,receipt){if(lock.current)return;const w=kind==='all'?null:window.open('about:blank','_blank');if(w)w.opener=null;
 return run(async()=>{try{const b=await call(record?'archive':'issue',record?{id:record}:{kind,receipt});const name=(state.order.order_number+'-'+kind+(kind==='all'?'.zip':'.pdf')).replace(/[^\w.-]/g,'-');if(kind==='all')download(b,name);else{const url=URL.createObjectURL(b);setPdf({url,name});if(w&&!w.closed){w.addEventListener('load',()=>{try{w.print()}catch{}},{once:true});w.location.replace(url)}}
 if(receipt)setSign(false);await refresh();setNote('PDF ready. Use the PDF viewer to print or save a copy.')}catch(e){if(w&&!w.closed)w.close();throw e}})}
 function filePicker(isTag){setPhoto(isTag);if(uploader.current){uploader.current.accept=isTag?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm';uploader.current.click()}}
 async function upload(file){if(!file)return;await run(async()=>{const meta={type:file.type,size:file.size,...(photo?{line:item.id,unit:slot}:{})};const ticket=await call('upload',meta);const {error:e}=await supabase.storage.from('delivery-evidence').uploadToSignedUrl(ticket.key,ticket.token,file,{contentType:file.type,upsert:false});if(e)throw Error('Upload failed. Check your connection and file format.');await save('attach',{...meta,key:ticket.key})})}
 const btn=(label,fn,disabled=false)=><button type="button" disabled={busy||disabled} onClick={fn}>{label}</button>;
 const locked=state&&(['completed','cancelled','shipped','expired'].includes(state.order.status)||['Out for Delivery','Delivered'].includes(state.delivery.status)||data.logs.some(l=>l.action==='delivery'&&['Out for Delivery','Delivered'].includes(l.details.after.status))||data.docs.some(d=>d.kind==='signed'));
 return <section className="gots-docs" onKeyDown={e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&!['file','checkbox'].includes(e.target.type))e.preventDefault()}}>
 <header><small>ORDER OPERATIONS</small><h3>Documents &amp; Delivery</h3></header>
 {error&&<p role="alert" className="form-message error">{error} {btn('Reload details',()=>run(refresh))}</p>}{note&&<p role="status">{note}</p>}
 {!state?!error&&<p>Loading order documents…</p>:<>
 <div className="doc-actions">{btn('Print Invoice',()=>print('invoice'))}{btn('Print Delivery Acknowledgment',()=>print('ack'))}{btn('Print Packing Slip',()=>print('packing'))}{btn('Download All PDFs',()=>print('all'))}{btn('Capture Customer Signature',()=>setSign(true))}{btn('Upload Delivery Evidence',()=>filePicker(false))}</div>
 {pdf&&<p><a href={pdf.url} download={pdf.name}>Download last PDF</a></p>}<input hidden ref={uploader} type="file" onChange={e=>{const f=e.target.files?.[0];e.target.value='';upload(f)}}/>
 <details><summary>Product Serial Numbers</summary>{item&&<><div className="doc-grid"><label>Order item<select aria-label="Order item" value={item.id} onChange={e=>{setLine(+e.target.value);setSlot(1)}}>{items.map(i=><option key={i.id} value={i.id}>{i.product_name}</option>)}</select></label><label>Unit<select aria-label="Unit" value={slot} onChange={e=>setSlot(+e.target.value)}>{Array.from({length:item.quantity},(_,n)=><option key={n} value={n+1}>{n+1} of {item.quantity}</option>)}</select></label>
 {Object.entries({serial:'Serial number',manufacturer:'Manufacturer',assay:'Assay certificate',weight:'Actual weight (include unit)',purity:'Purity'}).map(([k,label])=><label key={k}>{label}<input maxLength={100} disabled={locked} value={tag[k]||''} onChange={e=>setTag({...tag,[k]:e.target.value})}/></label>)}</div>
 <div className="doc-actions">{btn('Save unit',()=>run(()=>save('serial',{...Object.fromEntries(Object.keys(blank).map(k=>[k,tag[k]||''])),line:item.id,unit:slot})),locked||!Object.keys(blank).some(k=>tag[k]?.trim()))}{unit&&btn('Remove assignment',()=>run(()=>save('serial',{line:item.id,unit:slot,serial:''})),locked)}{unit&&btn('Add bar photo',()=>filePicker(true))}</div>{locked&&<small>Serial assignments are locked for this order.</small>}</>}</details>
 <details><summary>Delivery management</summary><div className="doc-grid"><label>Method<select aria-label="Method" value={delivery.method||''} onChange={e=>setDelivery({...delivery,method:e.target.value})}><option value="">Select method</option>{deliveryMethods.map(m=><option key={m}>{m}</option>)}</select></label><label>Delivery status<select aria-label="Delivery status" value={delivery.status||'Pending'} onChange={e=>setDelivery({...delivery,status:e.target.value})}>{deliveryStates.map(m=><option key={m}>{m}</option>)}</select></label>
 {Object.entries({actual:'Actual delivery time (local)',representative:'Representative',recipient:'Recipient',carrier:'Carrier',tracking:'Tracking number',notes:'Delivery notes'}).map(([k,label])=><label key={k}>{label}<input value={delivery[k]||''} maxLength={k==='notes'?1500:180} type={k==='actual'?'datetime-local':'text'} onChange={e=>setDelivery({...delivery,[k]:e.target.value})}/></label>)}</div>{btn('Save delivery details',()=>run(()=>save('delivery',{...delivery,actual:delivery.actual?new Date(delivery.actual).toISOString():''})),!delivery.method)}<small>Delivery records do not change payment or fulfillment status.</small></details>
 <details><summary>Issued documents ({data.docs.length})</summary>{data.docs.map(r=><div className="doc-entry" key={r.id}><span>{captions[r.kind]} · {timeLabel(r.created_at)}</span>{btn('Open PDF',()=>print(r.kind,r.id))}</div>)}</details>
 <details><summary>Delivery history &amp; evidence</summary>{data.logs.map(l=><div className="doc-entry" key={l.id}><span>{timeLabel(l.created_at)} · {l.action==='issue'?captions[l.details.kind]+' issued':l.action==='serial'?'Unit '+l.details.after.unit+': '+(l.details.before?.serial||'—')+' → '+(l.details.after.serial||'Removed'):l.action==='delivery'?l.details.after.status:'Evidence added'+(l.details.after.serial?' · '+l.details.after.serial:'')}</span>{l.action==='evidence'&&btn('View evidence',()=>{const w=window.open('about:blank','_blank');if(w)w.opener=null;run(async()=>{try{const {url}=await call('view',{id:l.id});if(w)w.location.replace(url);else throw Error('Allow a new tab to view evidence.')}catch(e){w?.close();throw e}})})}</div>)}</details>
 {sign&&<Signature state={state} busy={busy} error={error} cancel={()=>setSign(false)} submit={r=>print('signed',null,r)}/>}</>}</section>
}

function Signature({state,busy,error,cancel,submit}){
 const ref=useRef(),canvas=useRef(),lines=useRef([]),active=useRef(null),[name,S]=useState(''),[ok,O]=useState(false),[id,I]=useState(false),[condition,C]=useState('Intact'),[drawn,D]=useState(false);
 useEffect(()=>{ref.current?.showModal()},[]);
 function pos(e){const r=canvas.current.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]}
 function move(e){if(active.current!==e.pointerId)return;const l=lines.current.at(-1),a=l.at(-1),b=pos(e);if(l.length>=2400)return;l.push(b);const ctx=canvas.current.getContext('2d');ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a[0]*800,a[1]*180);ctx.lineTo(b[0]*800,b[1]*180);ctx.stroke();D(true)}
 return <dialog ref={ref} className="doc-sign" onCancel={e=>{e.preventDefault();if(!busy)cancel()}}><h2>Confirm your delivery</h2><p>{state.order.order_number} · {money(state.order.total)}</p>{state.items.map(i=><p key={i.id}><b>{i.quantity} × {i.product_name}</b>{i.units.map(u=><small key={u.unit}>{unitText(u)}</small>)}</p>)}<p>{acknowledgment}</p>{state.items.some(i=>i.units.some(u=>u.serial))&&<p>{serialAcknowledgment}</p>}
 <label>Recipient printed name<input maxLength={120} value={name} onChange={e=>S(e.target.value)}/></label><label>Package condition<select aria-label="Package condition" value={condition} onChange={e=>C(e.target.value)}><option>Intact</option><option>Damage noted</option></select></label>
 <label><input type="checkbox" checked={id} onChange={e=>I(e.target.checked)}/> Representative checked recipient ID</label><label><input type="checkbox" checked={ok} onChange={e=>O(e.target.checked)}/> I confirm the listed merchandise was handed directly to me.</label>
 <canvas aria-label="Draw recipient signature" ref={canvas} width="800" height="180" onPointerDown={e=>{if(active.current!==null||lines.current.length>=100)return;active.current=e.pointerId;e.target.setPointerCapture(e.pointerId);lines.current.push([pos(e)])}} onPointerMove={move} onPointerUp={()=>{active.current=null}} onPointerCancel={()=>{active.current=null}}/>
 {error&&<p role="alert">{error}</p>}<div className="doc-actions"><button type="button" disabled={busy} onClick={()=>{canvas.current.getContext('2d').clearRect(0,0,800,180);lines.current=[];D(false)}}>Clear signature</button><button type="button" disabled={busy||!ok||!name.trim()||!drawn} onClick={()=>submit({name,confirmed:ok,idChecked:id,condition,strokes:lines.current.filter(s=>s.length>1)})}>Sign and confirm receipt</button><button type="button" disabled={busy} onClick={cancel}>Cancel</button></div></dialog>
}
