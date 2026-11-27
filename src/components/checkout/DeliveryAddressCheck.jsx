import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {readyToCheck} from '../../../shared/deliveryAddress.js';

export function useDeliveryAddress(address,enabled,{preview=false}={}) {
  const key=JSON.stringify(address);
  const [response,setResponse]=useState(null);
  const [attempt,setAttempt]=useState(0);
  const ready=enabled && readyToCheck(address);
  useEffect(()=>{
    if(!ready)return;
    const abort=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const headers={'content-type':'application/json'};
        if(!preview) {
          const {data}=await supabase.auth.getSession();
          if(data.session?.access_token)headers.authorization='Bearer '+data.session.access_token;
        }
        const res=await fetch('/api/checkout/tax',{method:'POST',headers,
          body:JSON.stringify({mode:'address',address:JSON.parse(key)}),signal:abort.signal});
        const value=await res.json();
        if(!abort.signal.aborted)setResponse({key,attempt,value:res.ok?value:{status:'unavailable',message:value.error || 'Address lookup is unavailable.'}});
      } catch {
        if(!abort.signal.aborted)setResponse({key,attempt,value:{status:'unavailable',message:'Address lookup is temporarily unavailable.'}});
      }
    },550);
    return()=>{clearTimeout(timer);abort.abort();};
  },[key,ready,attempt,preview]);
  const result=ready && response?.key===key && response.attempt===attempt ? response.value : null;
  return {result,canonical:result?.status==='matched'?result.address:null,retry:()=>setAttempt(n=>n+1)};
}

export function DeliveryAddressCheck({check,onUse,onEdit,onFill,showMatched=false}) {
  const {result,retry}=check;
  useEffect(()=>{
    if(result?.status==='matched' && result.fill?.length && onFill)onFill(result.address,result.fill);
  },[result,onFill]);
  if(!result)return null;
  if(result.status==='matched' && !showMatched)return null;
  if(result.status==='suggestion' || result.status==='matched') {
    const a=result.address;
    return <div className="form-message" role="status">
      <strong>{result.status==='matched'?'Standardized address':'Did you mean this address?'}</strong>
      <div>{a.address_line_1}{a.address_line_2?', '+a.address_line_2:''}</div>
      <div>{a.city}, {a.state} {a.postal_code}</div>
      {result.status==='suggestion'&&<><button type="button" className="text-button" onClick={()=>onUse(a)}>Use this address</button>{' · '}
        <button type="button" className="text-button" onClick={onEdit}>Edit my address</button></>}
    </div>;
  }
  return <div className="form-message" role="status">{result.message}{result.status==='unavailable' && <> <button type="button" className="text-button" onClick={retry}>Try again</button></>}</div>;
}
