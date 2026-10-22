import { useEffect, useRef, useState } from "react";
import { ChevronDown, Headphones, LockKeyhole, MessageSquareText, Send, ShieldCheck, XCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { requestReference, supportRequest } from "../lib/supportRequests";
import { supabase } from "../lib/supabase";
import { supportFaqs } from "../lib/supportKnowledge";
import { useAuth } from "../state/AuthContext";

const blankTicket = { category: "order", order_number: "", subject: "", message: "" };
const statusLabel = { open: "Awaiting support", in_progress: "Being reviewed", resolved: "Answered", closed: "Closed" };

export default function SupportPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const activeRequest = useRef(false), requestId = useRef(null), linkedTicket = useRef(null), currentUser = useRef(user?.id);
  const confirmationRef = useRef(null);
  const ticketLoadVersion = useRef(0);
  currentUser.current = user?.id;
  const [messageErrors, setMessageErrors] = useState({});
  const [openFaq, setOpenFaq] = useState("live-pricing");
  const [tickets, setTickets] = useState([]);
  const [messages, setMessages] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [replies, setReplies] = useState({});
  const [ticket, setTicket] = useState(blankTicket);
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  const loadTickets = async () => {
    if (!user) return;
    const owner=user.id;
    const version=++ticketLoadVersion.current;
    try {
      const { data, error } = await supabase.from("support_tickets").select("id,ticket_number,category,order_number,subject,message,status,created_at,updated_at").eq("user_id", owner).order("updated_at", { ascending: false });
      if(currentUser.current!==owner || version!==ticketLoadVersion.current)return;
      if(error)throw error;
      setTickets(data || []);
    } catch {if(currentUser.current===owner && version===ticketLoadVersion.current)setNotice("Support history could not be loaded. Please refresh it.");}
    finally {if(currentUser.current===owner && version===ticketLoadVersion.current)setLoading(false);}
  };
  const loadMessages = async (ticketId) => {
    const owner=user?.id;
    try {
      const {data,error}=await supabase.from("support_ticket_messages").select("id,ticket_id,author_role,message,created_at").eq("ticket_id",ticketId).order("created_at").order("id");
      if(error)throw error;
      if(currentUser.current!==owner)return;
      setMessages(current=>({...current,[ticketId]:data || []}));setMessageErrors(current=>({...current,[ticketId]:null}));
    }catch{if(currentUser.current===owner)setMessageErrors(current=>({...current,[ticketId]:"Messages could not be loaded. Please try Refresh conversation."}));}
  };
  useEffect(()=>{
    setTickets([]);setMessages({});setReplies({});setExpanded(null);setNotice("");setTicket(blankTicket);setConfirmation(null);setFormError(null);linkedTicket.current=null;requestId.current=null;
    if(!user){setLoading(false);return;}
    setLoading(true);loadTickets();
  },[user?.id]);
  useEffect(()=>{if(confirmation)confirmationRef.current?.focus();},[confirmation]);
  const targetTicket=params.get('ticket');
  useEffect(()=>{
    if(!targetTicket || loading || linkedTicket.current===targetTicket)return;
    const target=tickets.find(item=>item.ticket_number===targetTicket);
    if(target){linkedTicket.current=targetTicket;setExpanded(target.id);loadMessages(target.id);document.getElementById('support-inbox')?.scrollIntoView({behavior:'smooth'});}
  },[targetTicket,tickets,loading]);
  const toggleTicket=async(id)=>{const next=expanded===id?null:id;setExpanded(next);if(next)await loadMessages(id);};
  const trackTicket=(item)=>{
    linkedTicket.current=item.ticket_number;
    setParams({ticket:item.ticket_number});setExpanded(item.id);loadMessages(item.id);
    document.getElementById('support-inbox')?.scrollIntoView({behavior:'smooth'});
  };
  const refreshHistory=()=>Promise.all([loadTickets(),...(expanded?[loadMessages(expanded)]:[])]);
  const submitTicket=async(event)=>{
    event.preventDefault();if(activeRequest.current)return;
    if(!user){setFormError({text:'Please sign in again before submitting your ticket.',status:401});return;}
    const subject=ticket.subject.trim(),message=ticket.message.trim();
    const invalid=subject.length<4 || subject.length>120 ? ['subject','Enter a subject between 4 and 120 characters.'] : message.length<10 || message.length>3000 ? ['message','Describe your request in at least 10 characters (up to 3,000).'] : null;
    if(invalid){setFormError({field:invalid[0],text:invalid[1]});event.currentTarget.elements.namedItem(invalid[0])?.focus();return;}
    activeRequest.current=true;setBusy('new');setFormError(null);setNotice('');
    const owner=user.id;
    const body={action:'create',category:ticket.category,order_number:ticket.order_number.trim() || null,subject:ticket.subject.trim(),message:ticket.message.trim()};
    try{
      const result=await supportRequest({...body,request_id:requestReference(requestId,body)});
      if(currentUser.current!==owner)return;
      if(!result?.ok || !result.ticket?.id || !result.ticket?.ticket_number)throw new Error('We could not confirm the result. Please try again with the same details; your request will not be duplicated.');
      requestId.current=null;setTicket(blankTicket);setConfirmation({ticket:result.ticket,emailQueued:result.email_queued===true});
      ticketLoadVersion.current++;setLoading(false);
      // The committed server result is the receipt. A slow history refresh must
      // never hold the submit button or hide a successfully received ticket.
      setTickets(current=>[result.ticket,...current.filter(item=>item.id!==result.ticket.id)]);
      setMessages(current=>({...current,[result.ticket.id]:[{id:'received',author_role:'customer',message:result.ticket.message,created_at:result.ticket.created_at}]}));
    }catch(error){if(currentUser.current===owner)setFormError({text:error.message || 'We could not create the ticket. Your message has been kept.',status:error.status});}
    finally{activeRequest.current=false;setBusy('');}
  };
  const runAction=async(item,action)=>{
    if(activeRequest.current)return;activeRequest.current=true;setBusy(`${action}-${item.id}`);setNotice('');
    const body={action,ticket_id:item.id,...(action==='reply'?{message:replies[item.id] || ''}:{})};
    try{
      await supportRequest({...body,request_id:requestReference(requestId,body)});
      requestId.current=null;setReplies(current=>({...current,[item.id]:''}));
      setNotice(action==='reply'?'Reply sent securely.':action==='reopen'?'Ticket reopened.':'Ticket closed.');
      await Promise.all([loadTickets(),loadMessages(item.id)]);setExpanded(item.id);
    }catch(error){setNotice(error.message || 'That support action could not be completed. Your draft has been kept.');}
    finally{activeRequest.current=false;setBusy('');}
  };

  return <>
    <section className="support-hero"><div className="container"><span className="eyebrow">CUSTOMER CARE</span><h1>Help that stays with you.</h1><p>Ask a quick question, open a private request, and keep every reply together until the issue is resolved.</p><div><span><ShieldCheck /> Private ticket conversations</span><span><Headphones /> Human follow-up</span><span><LockKeyhole /> Email alerts without sensitive details</span></div></div></section>
    <section className="section support-section"><div className="container support-grid">
      <div><div className="section-heading"><div><span className="eyebrow dark">QUICK ANSWERS</span><h2>Before you open a ticket</h2><p>Common answers about pricing, payment, shipping, and accounts.</p></div></div><div className="faq-list">{supportFaqs.map((item) => <article className={openFaq === item.id ? "open" : ""} key={item.id}><button onClick={() => setOpenFaq(openFaq === item.id ? "" : item.id)} aria-expanded={openFaq === item.id}><span><small>{item.category}</small>{item.question}</span><ChevronDown /></button>{openFaq === item.id && <div><p>{item.answer}</p>{item.links.map((link) => <Link key={link.to} to={link.to}>{link.label} →</Link>)}</div>}</article>)}</div></div>
      <aside className="support-contact-card">
        <MessageSquareText /><span className="eyebrow dark">CONTACT SUPPORT</span>
        <h2>{user ? confirmation ? "Request received" : "Start a private request" : "Sign in for private support"}</h2>
        {user ? confirmation ? <div className="support-receipt" ref={confirmationRef} tabIndex={-1} aria-labelledby="ticket-received-heading">
          <ShieldCheck aria-hidden="true" />
          <h3 id="ticket-received-heading">Ticket received</h3>
          <p>Your request has been saved. Our support team can now review it.</p>
          <dl><dt>Ticket number</dt><dd>{confirmation.ticket.ticket_number}</dd><dt>Subject</dt><dd>{confirmation.ticket.subject}</dd><dt>Status</dt><dd>{statusLabel[tickets.find(item=>item.id===confirmation.ticket.id)?.status || confirmation.ticket.status]}</dd></dl>
          <p>{confirmation.emailQueued ? 'A confirmation email is queued for your verified email address. You can also track replies and status here.' : 'Track replies and status in Your conversations below. Email notifications are currently unavailable; your ticket is safely saved.'}</p>
          <Link className="button button-dark full" to={`/support?ticket=${encodeURIComponent(confirmation.ticket.ticket_number)}`} onClick={event=>{event.preventDefault();trackTicket(confirmation.ticket);}}>Track this ticket</Link>
          <button type="button" className="text-button" onClick={()=>{setConfirmation(null);setFormError(null);}}>Start another request</button>
        </div> : <form onSubmit={submitTicket} noValidate aria-busy={busy==='new'}>
          <label>What do you need help with?<select value={ticket.category} onChange={e=>setTicket({...ticket,category:e.target.value})}><option value="order">Existing order</option><option value="product">Product question</option><option value="payment">Payment</option><option value="shipping">Shipping</option><option value="account">Account</option><option value="other">Something else</option></select></label>
          <label>Order number <span>(if applicable)</span><input name="order_number" maxLength={40} placeholder="GOTS-2026-…" value={ticket.order_number} onChange={e=>setTicket({...ticket,order_number:e.target.value.toUpperCase()})} /></label>
          <label>Short subject<input name="subject" required minLength={4} maxLength={120} aria-invalid={formError?.field==='subject'} aria-describedby={formError?.field==='subject'?'ticket-form-error':undefined} placeholder="Example: Question about my wire payment" value={ticket.subject} onChange={e=>setTicket({...ticket,subject:e.target.value})} /></label>
          <label>Tell us what happened<textarea name="message" required minLength={10} maxLength={3000} rows={6} aria-invalid={formError?.field==='message'} aria-describedby={formError?.field==='message'?'ticket-message-help ticket-form-error':'ticket-message-help'} placeholder="Include the details we need to help, but never send passwords or financial credentials." value={ticket.message} onChange={e=>setTicket({...ticket,message:e.target.value})} /><small id="ticket-message-help">At least 10 characters. {ticket.message.trim().length.toLocaleString()} / 3,000</small></label>
          {formError && <div id="ticket-form-error" className="form-message error" role="alert">{formError.text}{[401,403].includes(formError.status) && <Link to="/login?return=%2Fsupport">Sign in and verify your account</Link>}</div>}
          <button type="submit" className="button button-gold full" disabled={Boolean(busy)}>{busy==='new'?'Submitting your request…':'Create support ticket'}</button>
          {busy==='new' && <p className="support-submit-progress" role="status">Please wait while we save your ticket. You do not need to click again.</p>}
          <small>Keep your ticket number to track replies and status here. When email alerts are available, they link securely to your conversation.</small>
        </form> : <><p>Sign in to keep your request, replies, and order details together securely.</p><Link className="button button-gold full" to={`/login?return=${encodeURIComponent('/support'+(params.toString()?'?'+params.toString():''))}`}>Sign in to contact support</Link><a className="support-email" href="mailto:support@goldonthespot.com">support@goldonthespot.com</a></>}
      </aside>
    </div></section>
    {user && <section className="section ticket-history-section" id="support-inbox"><div className="container"><div className="section-heading"><div><span className="eyebrow dark">SUPPORT INBOX</span><h2>Your conversations</h2><p>Open a ticket to read the full conversation and reply. Replying to an answered ticket reopens it automatically.</p></div><button type="button" className="text-button" disabled={Boolean(busy)} onClick={refreshHistory}>Refresh tickets</button><span className="status-pill">{tickets.filter((item) => !["resolved", "closed"].includes(item.status)).length} active</span></div>{notice && <div className="form-message" role="status">{notice}</div>}{loading ? <div className="catalog-loading">Loading your private conversations…</div> : tickets.length ? <div className="support-inbox">{tickets.map((item) => { const replyReopens = ["resolved", "closed"].includes(item.status); return <article className={`support-thread ${expanded === item.id ? "expanded" : ""}`} key={item.id}><button className="support-thread-summary" onClick={() => toggleTicket(item.id)}><div><small>{item.ticket_number} · {item.category}</small><h3>{item.subject}</h3><span>Updated {new Date(item.updated_at).toLocaleString()}</span></div><span className={`ticket-status ${item.status}`}>{statusLabel[item.status] || item.status}</span><ChevronDown /></button>{expanded === item.id && <div className="support-thread-body"><button type="button" className="text-button" onClick={()=>Promise.all([loadTickets(),loadMessages(item.id)])}>Refresh conversation</button>{messageErrors[item.id] && <div className="form-message error" role="alert">{messageErrors[item.id]}</div>}<div className="support-messages">{(messages[item.id] || []).map((entry) => <div className={`support-message ${entry.author_role}`} key={entry.id}><b>{entry.author_role === "admin" ? "GoldOnTheSpot Support" : "You"}</b><p>{entry.message}</p><small>{new Date(entry.created_at).toLocaleString()}</small></div>)}</div><label className="support-reply-box">{replyReopens ? "Reply and reopen this ticket" : "Reply"}<textarea rows="4" maxLength="5000" placeholder={replyReopens ? "Write your reply to reopen this conversation…" : "Add a message to this conversation…"} value={replies[item.id] || ""} onChange={(e) => setReplies((current) => ({ ...current, [item.id]: e.target.value }))} /></label><div className="support-thread-actions"><button className="button button-gold" onClick={() => runAction(item, "reply")} disabled={busy || !(replies[item.id] || "").trim()}><Send /> {busy === `reply-${item.id}` ? "Sending…" : replyReopens ? "Reply & reopen" : "Send reply"}</button>{!replyReopens && <button className="button button-outline" onClick={() => runAction(item, "close")} disabled={busy}><XCircle /> Close ticket</button>}</div></div>}</article>; })}</div> : <div className="empty-state compact"><h3>No support conversations yet</h3><p>Use the form above when you need help. Your replies will stay organized here.</p></div>}</div></section>}
  </>;
}
