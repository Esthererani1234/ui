import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
export default function PromoCodes(){
 const [rows,setRows]=useState([]),[busy,B]=useState(false),[msg,M]=useState('');
 async function run(action,params={}){B(true);M('');try{const {data,error}=await supabase.rpc('manage_store_promos',{action,...params});if(error)throw error;setRows(data);return true}catch(e){M(e.code==='23505'?'That code already exists.':'Could not complete the request. Check the values and try again.');return false}finally{B(false)}}
 useEffect(()=>{run('list')},[]);
 return <section className="admin-panel"><h2>Promo codes</h2><p>Discounts apply to merchandise. A use is counted when an order is placed. Cancellations do not restore uses.</p>
 <form onSubmit={async ev=>{ev.preventDefault();const f=ev.currentTarget,v=new FormData(f);if(await run('create',{code_input:v.get('code'),kind_input:v.get('kind'),amount_input:Number(v.get('amount')),limit_input:Number(v.get('uses'))}))f.reset()}}>
 <fieldset disabled={busy}><label>Code<input name="code" required pattern={"[A-Za-z0-9_\\-]{3,32}"} placeholder="WELCOME25"/></label><label>Discount type<select name="kind"><option value="usd">Dollars off</option><option value="percent">Percent off (under 100%)</option></select></label><label>Amount<input required type="number" name="amount" min=".01" step=".01"/></label><label>Maximum uses<input required name="uses" type="number" min="1" max="1000000" defaultValue="1"/></label><button className="button button-gold">Create code</button></fieldset></form>
 {msg&&<p role="alert">{msg}</p>}<button className="text-button" disabled={busy} onClick={()=>run('list')}>Refresh codes</button>{rows.map(r=><p key={r.code}><b>{r.code}</b> · {r.kind==='usd'?'$':''}{r.amount}{r.kind==='percent'?'%':''} off · {r.used}/{r.max_uses} used · {r.enabled?<button disabled={busy} onClick={()=>run('disable',{code_input:r.code})}>Disable</button>:'Disabled'}</p>)}</section>
}
