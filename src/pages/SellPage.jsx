import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Coins, Gem, Layers3, ShieldCheck } from 'lucide-react';
import { supabase, readOnlyPreview } from '../lib/supabase';
import { invokeFunction } from '../lib/functionRequest';
import { useAuth } from '../state/AuthContext';
import CustomerAccountNav from '../components/CustomerAccountNav';
import SellingCases from '../components/SellingCases';
import { requestReference } from '../lib/supportRequests';
import '../styles/sellPortal.css';

const materials=[['Au','Gold','Coins, bars, jewelry & scrap'],['Ag','Silver','Bullion, sterling & broken pieces'],['Pt','Platinum','Jewelry, coins & precious-metal scrap'],['Pd','Palladium','Bars, coins & precious-metal items']];
export default function SellPage({centre=false}) {
 const {user,profile}=useAuth();
 const contact=()=>({name:[profile?.first_name,profile?.last_name].filter(Boolean).join(' '),email:user?.email || '',phone:profile?.phone || '',message:'',website:''});
 const [form,setForm]=useState(contact);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null);
 const reference=useRef(null),saving=useRef(false),nameInput=useRef(null),receiptHeading=useRef(null);
 useEffect(()=>{if(receipt)receiptHeading.current?.focus();},[receipt]);
 function begin(){nameInput.current?.closest('.sell-form-card')?.scrollIntoView({behavior:'smooth',block:'start'});nameInput.current?.focus({preventScroll:true});}
 async function submit(event) {
  event.preventDefault();if(saving.current || readOnlyPreview || !user || !centre)return;
  const body={action:'create',...Object.fromEntries(Object.entries(form).map(([key,value])=>[key,value.trim()]))};
  saving.current=true;setBusy(true);setError('');
  try{
   const result=await invokeFunction(supabase,'sell-requests',{...body,request_id:requestReference(reference,body)},{timeout:25000});
   if(!result?.reference)throw new Error('We could not confirm your request. Please try again.');
   setReceipt(result);reference.current=null;
  }catch(e){setError(e.message || 'Your request could not be sent. Your details are still here—please try again.');}
  finally{saving.current=false;setBusy(false);}
 }
 const update=e=>setForm(old=>({...old,[e.target.name]:e.target.value}));
 return <div className={centre?'sell-portal selling-centre':'sell-portal'}>
  {centre?<section className="container selling-centre-header"><CustomerAccountNav active="selling"/><span className="sell-eyebrow">YOUR PRECIOUS-METALS DESK</span><h1>Selling Centre</h1><p>Open a case, follow its progress, and keep your selling journey in one place.</p><button className="button button-gold" onClick={begin}>New selling case <ArrowRight size={18}/></button><SellingCases refreshKey={receipt?.reference}/></section>:<><section className="sell-hero"><div className="container sell-hero-grid">
   <div><span className="sell-eyebrow">THE OTHER SIDE OF PRECIOUS METALS</span><h1>Give your metals<br />their next chapter.</h1><p>From a single broken chain to a collection of bullion. Sell gold, silver, platinum, and palladium through a personal, straightforward quote experience.</p><Link className="button button-gold" to="/selling-centre">Get a quote <ArrowRight size={18}/></Link><small>Sign in to open and track your selling case. No obligation to sell.</small></div>
   <div className="sell-metal-grid" aria-label="Metals we evaluate">{materials.map(([symbol,name,description])=><div className={`sell-metal sell-metal-${symbol}`} key={symbol}><span>{symbol}</span><h2>{name}</h2><p>{description}</p></div>)}</div>
  </div></section>
  <div className="sell-assurance"><div className="container"><span><ShieldCheck size={18}/> Private quote requests</span><span><Gem size={18}/> Bullion, jewelry & scrap</span><span><CheckCircle2 size={18}/> You decide whether to sell</span></div></div>
  <section className="container sell-section"><div className="sell-section-heading"><span className="sell-eyebrow">VALUE BEYOND APPEARANCE</span><h2>Broken doesn’t mean worthless.</h2><p>A snapped clasp. An unmatched earring. Coins you’re ready to part with. Tell us what you have—even if you’re unsure of the weight or purity.</p></div>
   <div className="sell-item-grid"><article><Coins/><h3>Coins & bars</h3><p>Gold, silver, platinum, and palladium bullion, rounds, and coins. Share the mint, weight, and quantity if you know them.</p></article><article><Gem/><h3>Jewelry & broken pieces</h3><p>Rings, chains, bracelets, earrings, and damaged jewelry. Wear and breakage don’t erase the precious-metal content.</p></article><article><Layers3/><h3>Scrap for melting</h3><p>We accept precious-metal scrap for evaluation and potential melting and refining. Final acceptance depends on composition and condition.</p></article></div>
  </section>
  </>}
  <section className="container sell-workspace" id="sell-quote">
   <aside className="sell-process"><span className="sell-eyebrow">YOUR SELLING JOURNEY</span><h2>A conversation.<br/>Not a complication.</h2><ol><li><b>Tell us what you have</b><p>Add your contact details and a description. An approximate weight or purity marking helps, but isn’t required.</p></li><li><b>We review it with you</b><p>Our team follows up by email or phone to discuss the items, evaluation, and next steps.</p></li><li><b>Consider your offer</b><p>Any final offer depends on verified weight, purity, authenticity, and market conditions. You choose whether to proceed.</p></li></ol><div className="sell-safety"><ShieldCheck size={20}/><p>Please don’t ship items until we’ve agreed on instructions. Never include payment details, ID documents, or passwords in this form.</p></div></aside>
   <div className="sell-form-card">{!centre?<><span className="sell-eyebrow">YOUR SELLING CENTRE</span><h2>A home for every selling case.</h2><p>Sign in or create an account to tell us what you have, save your request, and follow its review status.</p><Link className="button button-gold" to="/selling-centre">Open Selling Centre <ArrowRight size={18}/></Link></>:receipt?<div className="sell-receipt" role="status"><CheckCircle2 size={44}/><span className="sell-eyebrow">CASE RECEIVED</span><h2 ref={receiptHeading} tabIndex={-1}>Your next chapter starts here.</h2><p>Your selling case is saved to your account and ready for review. Our team will contact you using the details you provided.</p><div className="sell-reference"><small>Your request reference—save this for follow-up</small><strong>{receipt.reference}</strong></div><p>This is a quote request, not an accepted offer or a price lock. Please wait for instructions before sending any items.</p><button type="button" className="button button-outline" onClick={()=>{setReceipt(null);setForm(contact());}}>Open another case</button><a href="#selling-cases">View my selling cases</a><Link to="/shop">Continue browsing bullion <ArrowRight size={16}/></Link></div>:<><span className="sell-eyebrow">LET’S SEE WHAT YOU HAVE</span><h2>Open a selling case.</h2><p>Start with a few details. We’ll take it from there.</p><form onSubmit={submit}>
    <label>Full name<input ref={nameInput} name="name" autoComplete="name" required minLength={2} maxLength={120} value={form.name} onChange={update} disabled={busy}/></label>
    <div className="sell-contact-fields"><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} value={user?.email || ''} readOnly/></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={30} value={form.phone} onChange={update} disabled={busy}/></label></div>
    <label>What would you like to sell?<textarea name="message" rows={6} required minLength={10} maxLength={5000} placeholder="For example: two broken 14k gold chains, approximately 18 grams, plus ten 1 oz silver coins. Unsure of the details? Describe what you know." value={form.message} onChange={update} disabled={busy}/></label>
    <div className="sell-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update}/></label></div>
    <p className="sell-form-privacy">We’ll use your details to respond to this request. <Link to="/privacy">Privacy policy</Link>. Submitting does not commit you to a sale.</p>
    {error&&<div className="form-message error" role="alert">{error}</div>}
    {readOnlyPreview&&<p role="status">Quote submissions are available on the <a href="https://goldonthespot.com/sell">live website</a>.</p>}
    <button type="submit" className="button button-gold" disabled={busy||readOnlyPreview}>{busy?'Sending your request…':'Create selling case'}<ArrowRight size={18}/></button>
   </form></>}</div>
  </section>
  <section className="container sell-faq"><h2>A little clarity before you begin.</h2><details><summary>Can I sell broken jewelry or scrap?</summary><p>Yes. We consider gold, silver, platinum, and palladium items—including broken jewelry and scrap for melting and refining. Each item is subject to evaluation and acceptance.</p></details><details><summary>Do I need to know the weight or purity?</summary><p>No. Include any markings or details you have, and tell us what you’re unsure about. Final valuation requires verification.</p></details><details><summary>Is the quote a guaranteed price?</summary><p>No. Initial discussions are indicative. A final offer depends on inspection, verified metal content, and applicable market conditions. No sale is agreed just by submitting this form.</p></details><details><summary>Should I send my items now?</summary><p>Please wait. We’ll discuss the next steps and provide instructions before you send anything.</p></details></section>
 </div>;
}
