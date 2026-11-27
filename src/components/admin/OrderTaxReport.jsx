import {useEffect,useState} from 'react';
import states from '../../../shared/taxSources.json';
const names=Object.fromEntries(states.map(s=>[s.code,s.name]));
const money=c=>c==null?'—':(Number(c)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const name=code=>names[code]||'Unassigned destination';
function AlaskaSaleEvidence({facts}){
  if(!facts)return null;
  return <p>Alaska protects the gold or silver value of qualifying specie from city and borough tax.
    {facts.metal_price_cents!=null&&<> At the order’s locked spot price, the metal accounts for <strong>{money(facts.metal_price_cents)}</strong> and the remaining markup is <strong>{money(facts.markup_cents)}</strong>.</>}
    {' '}<a href={facts.law} target="_blank" rel="noreferrer">Alaska session law</a></p>;
}
function ReviewReason({result}){
  const e=result.local_evidence;
  const state=result.state_scope;
  const specie=result.ak_specie;
  if(!e && !state && !specie)return <span>{result.reason}</span>;
  const scopes={no_state_general_sales_tax:'The state has no general sales tax.',
    state_administered_bullion_exemption:'Colorado exempts qualifying coins and bullion from state and state-administered taxes. Self-collecting cities set their own treatment.',
    consumer_bullion_exemption:'Arizona exempts qualifying bullion sold to the ultimate consumer. Coins sold to manufacture jewelry or art have separate treatment.'};
  const notes={outside_resort_areas:'The verified county is outside the published resort areas.',
    state_administered_municipality:'The state administers this municipality’s tax. Its bullion exemption covers qualifying gold and silver.',
    municipal_bullion_tax:'The city taxes retail bullion purchases, including investment and bulk purchases. Its rules distinguish bullion from currency exchanged at its ordinary exchange value.',
    municipal_bullion_exemption:'The city exempts qualifying coins and precious metal bullion from municipal sales and use tax.',
    aurora_bullion_rule:'Aurora exempts qualifying coins and precious metal bullion from its municipal sales and use tax.',
    town_resort_district:'The verified building is inside the town’s resort tax district.',
    rural_resort_district:'The verified building is inside the Hebgen Basin Rural Resort Area District.',
    structure_outside_resort_areas:'The verified building lies outside the published resort area and district boundaries.',
    no_general_retail_tax:'The municipality has no general retail sales tax on bullion.',
    member_general_rates:'Published general retail rates for the verified location'};
  return <details><summary>{result.reason}</summary>
    <AlaskaSaleEvidence facts={specie}/>
    {state&&<p>{scopes[state.scope]} <a href={state.source} target="_blank" rel="noreferrer">State authority</a></p>}
    {e&&<><p>{[e.geography.municipality?.name,e.geography.county.name].filter(Boolean).join(' · ')} · {notes[e.scope]}</p>
    {e.resort_components&&<p>{e.district_name} · {e.resort_components.map(c=>c.name+' '+c.ppm/10000+'%').join(' · ')}. The order’s bullion taxability and seller collection obligation require separate verification.</p>}
    {e.municipal_ppm!=null&&<p>City rate {e.municipal_ppm/10000}%. {e.shipping==='included'&&'The city includes shipping in the taxable price. '}<a href={e.rate_source} target="_blank" rel="noreferrer">City rate source</a></p>}
    {result.member_threshold&&<p>The verified delivery is in a commission member jurisdiction. Website receipts, including this order, are below its remote-seller threshold. <a href={result.member_threshold.source} target="_blank" rel="noreferrer">Commission rule</a></p>}
    {e.rates?.map(r=><p key={r.code}>{r.name} · {r.ppm/10000}% · Filing code {r.code}
      {Object.entries(r.caps).filter(([,v])=>v.limit_cents!=null).map(([k,v])=><span key={k}> · {money(v.limit_cents)} {k==='per_item'?'per item':'per transaction'} taxable-base limit</span>)}</p>)}
    <a href={e.source} target="_blank" rel="noreferrer">Jurisdiction source</a></>}</details>;
}
function OrderCalculation({orderId,request}){
  const [result,setResult]=useState(null),[loading,setLoading]=useState(false);
  async function run(){
    setLoading(true);
    try{setResult(await request('?view=order_calculation&order='+orderId));}
    catch(e){setResult({status:'review',reason:e.message});}finally{setLoading(false);}
  }
  if(!result)return <button type="button" className="text-button" onClick={run} disabled={loading}>{loading?'Calculating…':'Check tax'}</button>;
  if(result.status==='review')return <ReviewReason result={result}/>;
  return <details><summary>{result.status==='recorded'?'Verified order tax':'Calculated tax'} {money(result.tax)}</summary>
    <p>{result.state} · {result.day} · Taxable merchandise {money(result.taxable)} · Exempt merchandise {money(result.exempt)}{result.unclassified>0&&<> · Awaiting classification {money(result.unclassified)}</>}</p>
    <AlaskaSaleEvidence facts={result.ak_specie}/>
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
function PaymentPeriodReport({from,to,request}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[selected,select]=useState(null),[all,showAll]=useState(false);
  useEffect(()=>{
    let live=true;setData(null);setError('');select(null);
    request('?view=orders&from='+from+'&to='+to).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[from,to,request]);
  function download(){
    const columns=['state','orders','refunded_orders','merchandise','customer_total','recorded_tax','calculated_tax','missing_recorded','needs_review'];
    const header=['State','Paid orders','Orders marked refunded','Gross merchandise cents','Gross order total cents','Recorded tax cents (known only)','Calculated tax cents (known only)','Orders with unrecorded tax','Orders needing review'];
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

function NewOrderReports({from,to,request}){
  const [before,setBefore]=useState(null),[page,setPage]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let live=true,pending=false;
    const query=new URLSearchParams({view:'new_orders',from,to});if(before)query.set('before',before);
    async function load(){
      if(pending)return;pending=true;
      try{const data=await request('?'+query);if(live){setPage(data);setError('');}}
      catch(e){if(live)setError(e.message);}
      finally{pending=false;}
    }
    setPage(null);setError('');load();const timer=setInterval(()=>{if(!document.hidden)load();},60000);
    return()=>{live=false;clearInterval(timer);};
  },[from,to,before,request]);
  return <section aria-label="New order tax calculations"><h3>New order tax calculations</h3>
    {error&&<p role="alert">{error}</p>}{!page&&!error&&<p>Loading new orders…</p>}
    {page&&<><p>Orders placed from {new Date(page.starts_at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})} New York time are checked automatically.</p>
    {!page.orders.length?<p>No new orders in this period.</p>:<div className="tax-table"><table><thead><tr><th>Order</th><th>Destination</th><th>Calculated tax</th></tr></thead>
    <tbody>{page.orders.map(o=><tr key={o.id}><th>{o.order_number||o.id}</th><td>{name(o.state)}</td><td>
      {!o.result?'Queued':o.result.status==='review'?<ReviewReason result={o.result}/>:<details><summary>{money(o.result.tax)}</summary>
        <p>Taxable merchandise {money(o.result.taxable)} · Exempt merchandise {money(o.result.exempt)}{o.result.unclassified>0&&<> · Awaiting classification {money(o.result.unclassified)}</>}</p>
        <AlaskaSaleEvidence facts={o.result.ak_specie}/>
        {o.result.breakdown.map((b,i)=><p key={i}>{[b.name||b.code,b.county,...(b.districts||[])].filter(Boolean).join(' · ')} · {Number(b.ppm)/10000}% · {money(b.cents)}</p>)}
        {o.result.rate_source?.startsWith('https://')&&<a href={o.result.rate_source} target="_blank" rel="noreferrer">Rate source</a>}
      </details>}</td></tr>)}</tbody></table></div>}
    {before&&<button className="text-button" onClick={()=>setBefore(null)}>Newest orders</button>}
    {page.next&&<button className="text-button" onClick={()=>setBefore(page.next)}>Older orders</button>}</>}
  </section>;
}
function RuleCoverage({request}){
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let live=true;
    request('?view=rule_coverage').then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[request]);
  if(error)return <p role="alert">{error}</p>;
  if(!data)return <p>Loading rule coverage…</p>;
  const localReview={AK:'City and borough taxes',CO:'Self-collecting city taxes',MT:'Resort district taxes'};
  return <details><summary>Gold and silver tax rules · {data.reviewed_destinations} of {data.destinations} destinations reviewed</summary>
    <p>Reviewed for {data.day}. Each new order also needs a verified address and a collection decision.</p>
    {data.open_destinations.length>0&&<div className="tax-table"><table><thead><tr><th>Destination</th><th>Pending review</th></tr></thead>
      <tbody>{data.open_destinations.map(code=><tr key={code}><th>{name(code)}</th><td>{localReview[code]||'Dated bullion or collection rules'}</td></tr>)}</tbody></table></div>}
  </details>;
}
export default function OrderTaxReport({from,to,request}){
  const [period,showPeriod]=useState(false);
  return <><RuleCoverage request={request}/><NewOrderReports key={from+to} from={from} to={to} request={request}/>
    <details onToggle={e=>showPeriod(e.currentTarget.open)}><summary>Paid-order history and CSV</summary>
    {period&&<PaymentPeriodReport from={from} to={to} request={request}/>}</details></>;
}
