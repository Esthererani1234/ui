import {useEffect,useState} from 'react';
import states from '../../../shared/taxSources.json';
const names=Object.fromEntries(states.map(s=>[s.code,s.name]));
const money=c=>c==null?'—':(Number(c)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const name=code=>names[code]||'Unassigned destination';
function OrderCalculation({orderId,request}){
  const [result,setResult]=useState(null),[loading,setLoading]=useState(false);
  async function run(){
    setLoading(true);
    try{setResult(await request('?view=order_calculation&order='+orderId));}
    catch(e){setResult({status:'review',reason:e.message});}finally{setLoading(false);}
  }
  if(!result)return <button type="button" className="text-button" onClick={run} disabled={loading}>{loading?'Calculating…':'Check tax'}</button>;
  if(result.status==='review')return <span>{result.reason}</span>;
  return <details><summary>{result.status==='recorded'?'Verified order tax':'Calculated tax'} {money(result.tax)}</summary>
    <p>{result.state} · {result.day} · Taxable merchandise {money(result.taxable)} · Exempt merchandise {money(result.exempt)}</p>
    {result.breakdown.map((b,i)=><p key={i}>{[b.name||b.code,b.county,...(b.districts||[])].filter(Boolean).join(' · ')} · {Number(b.ppm)/10000}% · {money(b.cents)}</p>)}
    {result.rate_source?.startsWith('https://')&&<a href={result.rate_source} target="_blank" rel="noreferrer">Rate source</a>}
  </details>;
}
function Orders({state,from,to,request}){
  const [page,setPage]=useState(null),[error,setError]=useState(''),[before,setBefore]=useState(null);
  useEffect(()=>{
    let live=true;setPage(null);setError('');
    const query=new URLSearchParams({view:'orders',state,from,to});if(before)query.set('before',before);
    request('?'+query).then(d=>{if(live)setPage(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
  },[state,from,to,before,request]);
  return <div>{error&&<p role="alert">{error}</p>}{!page&&!error&&<p>Loading orders…</p>}
    {page&&<><h4>{name(state)} orders</h4>{page.orders.length?<div className="tax-table"><table><thead><tr>
      <th>Order</th><th>Paid on</th><th>Payment status</th><th>Merchandise</th><th>Recorded tax</th><th>Order tax calculation</th>
    </tr></thead><tbody>{page.orders.map(o=><tr key={o.order_id}><th>{o.order_number||o.order_id}</th><td>{o.paid_on}</td><td>{o.payment_status}</td>
      <td>{money(o.merchandise)}</td><td>{o.recorded_tax==null?'Unrecorded':money(o.recorded_tax)}</td><td><OrderCalculation orderId={o.order_id} request={request}/></td>
    </tr>)}</tbody></table></div>:<p>No paid orders in this period.</p>}
    {before&&<button className="text-button" onClick={()=>setBefore(null)}>Newest orders</button>}
    {page.next&&<button className="text-button" onClick={()=>setBefore(page.next)}>Older orders</button>}</>}
  </div>;
}
export default function OrderTaxReport({from,to,request}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[selected,select]=useState(null),[all,showAll]=useState(false);
  useEffect(()=>{
    let live=true;setData(null);setError('');select(null);
    request('?view=orders&from='+from+'&to='+to).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[from,to,request]);
  function download(){
    const columns=['state','orders','refunded_orders','merchandise','customer_total','recorded_tax','calculated_tax','missing_recorded','needs_review'];
    const header=['State','Paid orders','Orders marked refunded','Gross merchandise cents','Gross order total cents','Recorded tax cents (known only)','Verified tax cents (known only)','Orders with unrecorded tax','Orders needing review'];
    const rows=data.states.map(r=>columns.map(k=>r[k]??'').join(','));
    const url=URL.createObjectURL(new Blob([[header.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='order-tax-'+from+'-'+to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section aria-label="Website order tax report"><h3>Website order tax report</h3>
    <p>Gross sales by payment date, before refunds. An unrecorded tax amount needs review.</p>
    {error&&<p role="alert">{error}</p>}{!data&&!error&&<p>Loading report…</p>}
    {data&&<><div className="tax-period"><button className="button button-outline" onClick={download}>Download all jurisdictions (CSV)</button>
    <label><input type="checkbox" checked={all} onChange={e=>showAll(e.target.checked)}/> Include destinations with no orders</label></div>
    {!!data.missing_payment_date&&<p>{data.missing_payment_date} paid or refunded orders have no payment date and cannot be assigned to a period.</p>}
    {!data.states.some(s=>s.orders>0)&&<p>No paid orders in this period.</p>}
    {(all||data.states.some(s=>s.orders>0))&&<div className="tax-table"><table><thead><tr>
      <th>Destination</th><th>Paid orders</th><th>Marked refunded</th><th>Gross merchandise</th><th>Recorded tax</th><th>Tax reviews</th>
    </tr></thead><tbody>{data.states.filter(s=>all||s.orders>0).map(s=><tr key={s.state}><th><button className="text-button" onClick={()=>select(s.state)}>{name(s.state)}</button></th>
      <td>{s.orders}</td><td>{s.refunded_orders}</td><td>{money(s.merchandise??0)}</td>
      <td>{!s.orders?'—':s.recorded_tax==null?'Unrecorded':money(s.recorded_tax)}{s.recorded_tax!=null&&s.missing_recorded>0?' (partial)':''}</td><td>{s.needs_review}</td>
    </tr>)}</tbody></table></div>}
    {selected&&<Orders key={selected+from+to} state={selected} from={from} to={to} request={request}/>}</>}
  </section>;
}
