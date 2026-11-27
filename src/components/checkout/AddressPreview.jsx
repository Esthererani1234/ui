import {useRef,useState} from 'react';
import {DeliveryAddressCheck,useDeliveryAddress} from './DeliveryAddressCheck';
import {addressFields,fillAddressFields,draftAddress,readyToCheck} from '../../../shared/deliveryAddress.js';

export default function AddressPreview() {
  const [draft,setDraft]=useState({address1:'',address2:'',city:'',state:'',postalCode:''});
  const [submitted,setSubmitted]=useState(false);
  const [invalid,setInvalid]=useState(false);
  const street=useRef(null);
  const address=draftAddress(draft);
  const check=useDeliveryAddress(address,submitted,{preview:true});
  function update(key,value){setSubmitted(false);setInvalid(false);setDraft(d=>({...d,[key]:value}));}
  return <details open id="delivery-address"><summary>Check a delivery address</summary>
    <form className="tax-fields" onSubmit={e=>{e.preventDefault();if(!readyToCheck(address)){setInvalid(true);return;}setSubmitted(true);check.retry();}}>
      {Object.entries({address1:'Street address',address2:'Apartment or suite',city:'City',state:'State',postalCode:'ZIP code'}).map(([key,label])=><label key={key}>{label}<input ref={key==='address1'?street:undefined} value={draft[key]} maxLength={key==='state'?30:160} onChange={e=>update(key,e.target.value)}/></label>)}
      <button className="button button-outline" type="submit">Check address</button>
    </form>
    {invalid && <p role="status">Enter a street address and ZIP code, or a street address, city and state.</p>}
    {submitted && !check.result && <p role="status">Checking address…</p>}
    {submitted && <DeliveryAddressCheck check={check} showMatched onFill={(a,keys)=>setDraft(f=>fillAddressFields(f,a,keys))} onUse={a=>setDraft(addressFields(a))} onEdit={()=>{setSubmitted(false);street.current?.focus();}}/>}
  </details>;
}
