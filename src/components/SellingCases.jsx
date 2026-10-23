import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { invokeFunction } from '../lib/functionRequest';
const states={new:['Received','Your case is in our review inbox.'],reviewing:['In review','Our team is reviewing the items you described.'],contacted:['Contacted','Check your email or phone for our follow-up.'],quoted:['Quoted','Please refer to the offer discussed with our team.'],closed:['Closed','This case has been closed. You can open a new case for other items.']};
export default function SellingCases({refreshKey}) {
 const [cases,setCases]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false);
 const generation=useRef(0);
 async function load(append=false){const version=++generation.current;setLoading(true);setError('');try{const result=await invokeFunction(supabase,'sell-requests',{action:'mine',offset:append?cases.length:0},{timeout:25000});if(version!==generation.current)return;setCases(old=>append?[...new Map([...old,...result.requests].map(row=>[row.id,row])).values()]:result.requests);setMore(result.has_more);}catch(e){if(version===generation.current)setError(e.message || 'Your selling cases could not be loaded. Please try again.');}finally{if(version===generation.current)setLoading(false);}}
 useEffect(()=>{load();return()=>{generation.current++}},[refreshKey]);
 return <section className="selling-case-list" id="selling-cases" aria-label="My selling cases"><div className="panel-title"><h2>My selling cases</h2><button type="button" className="button button-outline" disabled={loading} onClick={()=>load()}>Refresh cases</button></div>
 {loading&&<p role="status">Loading your cases…</p>}{error&&<p className="form-message error" role="alert">{error}</p>}
 {!loading&&!error&&!cases.length&&<div className="selling-empty"><h3>Your selling journey starts here.</h3><p>Open your first case below. You can return here anytime to check its progress.</p></div>}
 {cases.map(item=><details className="selling-case" key={item.id} open={refreshKey===item.reference}><summary><span><strong>{item.reference}</strong><small>Opened {new Date(item.created_at).toLocaleDateString()}</small></span><b>{states[item.status]?.[0] || 'In review'}</b></summary><p className="selling-state-description">{states[item.status]?.[1]}</p><h3>Your items</h3><p className="selling-case-message">{item.message}</p><small>Last updated {new Date(item.updated_at).toLocaleString()}</small><p>Our team will follow up using your case’s contact details. Please wait for instructions before shipping items.</p></details>)}
 {more&&<button className="button button-outline" disabled={loading} onClick={()=>load(true)}>Load more cases</button>}
 </section>;
}
