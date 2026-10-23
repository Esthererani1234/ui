import {useState} from 'react';
import {Download} from 'lucide-react';
import {supabase} from '../lib/supabase';
export default function InvoiceDownload({order}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function download(){if(busy)return;setBusy(true);setError('');try{
  const {data,error:sessionError}=await supabase.auth.getSession();if(sessionError||!data.session)throw new Error('Please sign in again.');
  const response=await fetch(`/api/payments/invoice?order_id=${order.id}`,{headers:{authorization:`Bearer ${data.session.access_token}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'Invoice could not be downloaded.');}
  if(!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('Invoice could not be downloaded. Please retry.');
  const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`invoice-${String(order.order_number).replace(/[^a-zA-Z0-9-]/g,'')}.pdf`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){setError(e.name==='TimeoutError'?'Download timed out. Please retry.':e.message);}finally{setBusy(false);}}
 return <span><button className="text-button" type="button" onClick={download} disabled={busy}><Download size={16}/>{busy?'Preparing invoice…':'Download invoice'}</button>{error&&<small className="form-message error" role="alert">{error}</small>}</span>;
}
