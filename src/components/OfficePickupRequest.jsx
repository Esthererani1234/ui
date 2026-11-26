import {useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useCart} from '../state/CartContext';
import {supportRequest,requestReference} from '../lib/supportRequests';
import {officeAddress} from '../../shared/business.js';

export default function OfficePickupRequest({choice}){
 const {items}=useCart(),[when,setWhen]=useState(''),[receipt,setReceipt]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false),ref=useRef(null);
 async function submit(e){
  e.preventDefault();if(lock.current||!items.length)return;
  lock.current=true;setBusy(true);setError('');
  const list=items.map(i=>i.quantity+' × '+i.product.name+' (ID '+i.product.id+')').join('\n');
  const body={action:'create',category:'shipping',subject:'Office pickup request',order_number:null,message:'Requested items:\n'+list+'\n\nPreferred time (New York): '+(when.trim()||'Please contact me to arrange a time.')};
  try{if(body.message.length>3000)throw Error('This item list is too long. Please contact support to arrange the pickup.');
   const r=await supportRequest({...body,request_id:requestReference(ref,body)});if(!r?.ok||!r.ticket?.ticket_number)throw Error('We could not confirm the request. Please retry.');setReceipt(r.ticket.ticket_number);
  }catch(e){setError(e.message||'Could not submit. Please try again.')}finally{lock.current=false;setBusy(false)}
 }
 return <section className="section container narrow"><div className="checkout-form"><span className="eyebrow dark">GOLD ON THE SPOT</span>
 {receipt?<><h1>Pickup requested</h1><p>Reference: <b>{receipt}</b>.<br/>{officeAddress.join(\', \')}<br/> Your appointment is not confirmed. Please wait for our email before coming to the office.</p><Link className="button button-gold" to={'/support?ticket='+encodeURIComponent(receipt)}>Track pickup request</Link></>:<><h1>Checkout</h1>{!busy && choice}<h2>Arrange pickup</h2><p>Request your items below. We’ll email availability and your total before you pay. Items and prices aren’t reserved yet. There’s no shipping charge.</p>
 <p>Visit only after we confirm your appointment.</p>
 {items.length?<form onSubmit={submit}><fieldset disabled={busy}><legend>Items for pickup</legend><ul>{items.map(i=><li key={i.product.id}>{i.quantity} × {i.product.name}</li>)}</ul><label>Preferred day or time (optional, New York time)<input maxLength={160} value={when} onChange={e=>setWhen(e.target.value)} placeholder="For example, Tuesday afternoon"/></label></fieldset>
 {error&&<p role="alert">{error}</p>}<button className="button button-gold" disabled={busy}>{busy?'Sending…':'Request office pickup'}</button></form>:<p>Your cart is empty. <Link to="/shop">Browse bullion</Link></p>}
 </>}
 </div></section>
}
