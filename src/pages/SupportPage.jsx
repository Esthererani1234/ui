import DraftCaseImages,{useDraftCaseImages} from '../components/DraftCaseImages';
import SupportAttachments from '../components/SupportAttachments';
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, Headphones, LockKeyhole, Mail, MessageSquareText, Plus, RefreshCw, Send, ShieldCheck, UserRound, XCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { requestReference, supportRequest } from "../lib/supportRequests";
import { supabase } from "../lib/supabase";
import { supportFaqs } from "../lib/supportKnowledge";
import { useAuth } from "../state/AuthContext";
import CustomerAccountNav from "../components/CustomerAccountNav";
import "../styles/supportTickets.css";

const blankTicket = { category: "order", order_number: "", subject: "", message: "" };
const statusLabel = { open: "Awaiting support", in_progress: "Being reviewed", resolved: "Answered", closed: "Closed" };

const categoryLabel = { order: "Order", product: "Product", payment: "Payment", shipping: "Shipping", account: "Account", other: "General question" };

function TicketTime({ value, compact = false }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>Date unavailable</span>;
  const full = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return <time dateTime={date.toISOString()} title={full}>{compact ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : full}</time>;
}

function TicketStatus({ status }) {
  return <span className={`ticket-status ${status}`}><span className="support-status-dot" aria-hidden="true" />{statusLabel[status] || status}</span>;
}

export default function SupportPage() {
 const images=useDraftCaseImages('support');
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
  const expanded = tickets.find(item => item.ticket_number === params.get('ticket'))?.id || null;
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
      setNotice(current=>current==='Support history could not be loaded. Please refresh it.'?'':current);
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
    images.reset();setTickets([]);setMessages({});setMessageErrors({});setReplies({});setNotice("");setTicket(blankTicket);setConfirmation(null);setFormError(null);linkedTicket.current=null;requestId.current=null;
    if(!user){setLoading(false);return;}
    setLoading(true);loadTickets();
  },[user?.id]);
  useEffect(()=>{if(confirmation)confirmationRef.current?.focus();},[confirmation]);
  const targetTicket=params.get('ticket');
  const newRequest=params.get('new')==='1';
  const requestedOrder=(params.get('order') || '').slice(0,40);
  const requestedCategory=params.get('category');
  const focusRequest=()=>{
    document.getElementById('new-support-request')?.scrollIntoView({behavior:'auto',block:'start'});
    document.getElementById('support-subject')?.focus({preventScroll:true});
  };
  const focusConversation=(id)=>window.requestAnimationFrame(()=>{
    const element=document.getElementById(`support-ticket-${id}`);
    element?.scrollIntoView({behavior:'auto',block:'start'});
    element?.focus({preventScroll:true});
  });
  useEffect(()=>{
    if(!newRequest || !user)return;
    setConfirmation(null);setFormError(null);
    setTicket(current=>current.subject || current.message || current.order_number ? current : {
      ...current,
      category:Object.hasOwn(categoryLabel,requestedCategory) ? requestedCategory : 'order',
      order_number:/^[A-Z0-9-]{1,40}$/i.test(requestedOrder) ? requestedOrder.toUpperCase() : '',
    });
    const frame=window.requestAnimationFrame(focusRequest);
    return ()=>window.cancelAnimationFrame(frame);
  },[newRequest,requestedOrder,requestedCategory,user?.id]);
  useEffect(()=>{
    if(!targetTicket){linkedTicket.current=null;return;}
    if(loading)return;
    const target=tickets.find(item=>item.ticket_number===targetTicket);
    if(target && linkedTicket.current!==targetTicket){linkedTicket.current=targetTicket;loadMessages(target.id);focusConversation(target.id);}
  },[targetTicket,tickets,loading]);
  const toggleTicket=async(id)=>{
    const next=expanded===id?null:id;
    const number=tickets.find(item=>item.id===next)?.ticket_number;
    linkedTicket.current=number || null;
    setParams(number?{ticket:number}:{});
    if(next)await loadMessages(id);
  };
  const startRequest=(event)=>{
    if(images.busy||activeRequest.current){event?.preventDefault();return;} images.reset();
    event?.preventDefault();setConfirmation(null);setFormError(null);
    setParams({new:'1',...(requestedOrder?{order:requestedOrder}:{}),...(requestedCategory?{category:requestedCategory}:{})});
    window.requestAnimationFrame(focusRequest);
  };
  const trackTicket=(item)=>{
    linkedTicket.current=item.ticket_number;
    setParams({ticket:item.ticket_number});loadMessages(item.id);
    focusConversation(item.id);
  };
  const refreshHistory=()=>Promise.all([loadTickets(),...(expanded?[loadMessages(expanded)]:[])]);
  const submitTicket=async(event)=>{
    event.preventDefault();if(activeRequest.current||images.busy)return;
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
      await images.upload(result.ticket.id);
    }catch(error){if(currentUser.current===owner)setFormError({text:error.message || 'We could not create the ticket. Your message has been kept.',status:error.status});}
    finally{activeRequest.current=false;setBusy('');}
  };
  const runAction=async(item,action)=>{
    const owner=user?.id;
    if(!owner || (action==='reply' && (messageErrors[item.id] || !messages[item.id])))return;
    if(activeRequest.current)return;activeRequest.current=true;setBusy(`${action}-${item.id}`);setNotice('');
    const body={action,ticket_id:item.id,...(action==='reply'?{message:replies[item.id] || ''}:{})};
    try{
      await supportRequest({...body,request_id:requestReference(requestId,body)});
      if(currentUser.current!==owner)return;
      requestId.current=null;setReplies(current=>({...current,[item.id]:''}));
      setNotice(action==='reply'?'Reply sent securely.':action==='reopen'?'Ticket reopened.':'Ticket closed.');
      await Promise.all([loadTickets(),loadMessages(item.id)]);
    }catch(error){if(currentUser.current===owner)setNotice(error.message || 'That support action could not be completed. Your draft has been kept.');}
    finally{activeRequest.current=false;setBusy('');}
  };

  const activeCount = tickets.filter(item => !["resolved", "closed"].includes(item.status)).length;

  return <div className="customer-support">
    <section className="support-desk-hero" aria-labelledby="support-page-heading">
      <div className="container support-desk-hero-inner">
        <div>
          <span className="eyebrow">GOLD ON THE SPOT · CUSTOMER CARE</span>
          <h1 id="support-page-heading">Your support desk.</h1>
          <p>From your first question to your next delivery.<br />A direct line to our team, all in one place.</p>
          <nav className="support-desk-shortcuts" aria-label="Support shortcuts">
            {user && <a className="button button-gold" href="#support-inbox"><MessageSquareText aria-hidden="true" /> Your conversations</a>}
            <a className={`button ${user ? "support-hero-secondary" : "button-gold"}`} href="#new-support-request" onClick={user?startRequest:undefined}><Plus aria-hidden="true" /> {user ? "New request" : "Contact our team"}</a>
          </nav>
        </div>
        <div className="support-desk-assurance">
          <Headphones aria-hidden="true" />
          <div><b>Personal support. Private conversations.</b><p>Order questions, product guidance, or account help. Keep the details and every reply together.</p><span><LockKeyhole aria-hidden="true" /> Securely linked to your account</span></div>
        </div>
      </div>
    </section>

    {user && <div className="container support-account-navigation"><CustomerAccountNav active="support" /></div>}
    <div className="container support-workspace">
      {user ? <section className="support-history" id="support-inbox" aria-labelledby="support-inbox-heading">
        <header className="support-desk-heading">
          <div><span className="eyebrow dark">YOUR SUPPORT INBOX</span><h2 id="support-inbox-heading">Your conversations</h2><p>Updates, answers, and next steps for every request.</p></div>
          <button type="button" className="support-refresh" disabled={Boolean(busy) || loading} onClick={refreshHistory}><RefreshCw size={16} aria-hidden="true" /> Refresh tickets</button>
        </header>
        <div className="support-inbox-overview"><span><b>{tickets.length}</b> {tickets.length === 1 ? "conversation" : "conversations"}</span><span className="support-active-count"><span className="support-status-dot" aria-hidden="true" />{activeCount} active</span><span className="support-inbox-note">Latest activity first</span></div>
        {notice && <div className="form-message support-feedback" role="status">{notice}</div>}
        {loading ? <div className="support-empty" role="status"><MessageSquareText aria-hidden="true" /><h3>Loading your conversations…</h3><p>Gathering your requests and the latest updates.</p></div> : tickets.length ? <div className="support-inbox">{tickets.map(item => {
          const replyReopens = ["resolved", "closed"].includes(item.status);
          const isExpanded = expanded === item.id;
          const threadMessages = messages[item.id];
          return <article className={`support-thread ${isExpanded ? "expanded" : ""}`} key={item.id} id={`support-ticket-${item.id}`} tabIndex={-1}>
            <button type="button" className="support-thread-summary" onClick={() => toggleTicket(item.id)} aria-expanded={isExpanded} aria-controls={`support-conversation-${item.id}`}>
              <div className="support-ticket-copy">
                <span className="support-ticket-reference">{item.ticket_number}<span aria-hidden="true"> · </span>{categoryLabel[item.category] || item.category}</span>
                <h3 id={`support-subject-${item.id}`}>{item.subject}</h3>
                <span className="support-ticket-updated">Updated <TicketTime value={item.updated_at} compact /></span>
              </div>
              <TicketStatus status={item.status} />
              <ChevronDown aria-hidden="true" />
            </button>
            {isExpanded && <div className="support-thread-body" id={`support-conversation-${item.id}`} role="region" aria-labelledby={`support-subject-${item.id}`}>
              <div className="support-conversation-toolbar"><h4>Conversation</h4><button type="button" className="support-refresh" disabled={Boolean(busy)} onClick={() => Promise.all([loadTickets(), loadMessages(item.id)])}><RefreshCw size={14} aria-hidden="true" /> Refresh conversation</button></div>
              {item.order_number && <p className="support-order-reference">Regarding order <b>{item.order_number}</b></p>}
              {messageErrors[item.id] && <div className="form-message error" role="alert">{messageErrors[item.id]}</div>}
              <div className="support-messages" aria-label="Conversation messages">
                {!threadMessages && !messageErrors[item.id] && <p className="support-thread-loading" role="status">Loading conversation…</p>}
                {(threadMessages || []).map(entry => <div className={`support-message ${entry.author_role}`} key={entry.id}>
                  <div className="support-message-avatar" aria-hidden="true">{entry.author_role === "admin" ? <ShieldCheck size={18} /> : <UserRound size={18} />}</div>
                  <div className="support-message-content"><header><b>{entry.author_role === "admin" ? "GoldOnTheSpot Support" : "You"}</b><TicketTime value={entry.created_at} /></header><p>{entry.message}</p></div>
                </div>)}
                {threadMessages?.length === 0 && !messageErrors[item.id] && <div className="support-message customer"><div className="support-message-avatar" aria-hidden="true"><UserRound size={18} /></div><div className="support-message-content"><header><b>You · Original request</b><TicketTime value={item.created_at} /></header><p>{item.message}</p></div></div>}
              </div>
              <SupportAttachments caseId={item.id} onUploaded={loadTickets}/>
              <div className="support-reply-composer">
                <label className="support-reply-box" htmlFor={`support-reply-${item.id}`}>{replyReopens ? "Reply and reopen this ticket" : "Reply"}</label>
                <p id={`support-reply-help-${item.id}`}>{replyReopens ? "Need more help? Your reply will reopen this conversation." : "Add a detail or ask a follow-up. Our team will see it here."}</p>
                <textarea id={`support-reply-${item.id}`} aria-describedby={`support-reply-help-${item.id}`} rows={4} maxLength={5000} placeholder="Write your message…" value={replies[item.id] || ""} onChange={event => setReplies(current => ({ ...current, [item.id]: event.target.value }))} />
                <div className="support-thread-actions">
                  {!replyReopens && <button type="button" className="support-close-ticket" onClick={() => runAction(item, "close")} disabled={Boolean(busy)}><XCircle size={16} aria-hidden="true" /> {busy === `close-${item.id}` ? "Closing…" : "Close ticket"}</button>}
                  <button type="button" className="button button-dark" onClick={() => runAction(item, "reply")} disabled={Boolean(busy) || Boolean(messageErrors[item.id]) || !threadMessages || !(replies[item.id] || "").trim()}><Send size={16} aria-hidden="true" /> {busy === `reply-${item.id}` ? "Sending…" : replyReopens ? "Reply & reopen" : "Send reply"}</button>
                </div>
              </div>
            </div>}
          </article>;
        })}</div> : <div className="support-empty"><MessageSquareText aria-hidden="true" /><h3>No support conversations yet</h3><p>Have a question? Start a request and we’ll keep every reply together here.</p><a className="button button-outline" href="#new-support-request"><Plus size={16} aria-hidden="true" /> Start your first request</a></div>}
        <p className="support-inbox-footer"><LockKeyhole size={14} aria-hidden="true" /> Only you and our support team can view your conversations.</p>
      </section> : <section className="support-welcome" aria-labelledby="support-welcome-heading">
        <span className="eyebrow dark">HERE TO HELP</span><h2 id="support-welcome-heading">A little guidance.<br />A clear next step.</h2><p>Whether you’re choosing your first coin or following an order, we’ll help you find the right answer.</p>
        <div className="support-welcome-options"><div><MessageSquareText aria-hidden="true" /><span><b>One conversation, start to finish</b><p>Sign in to create a request, see updates, and reply directly to our team.</p></span></div><div><Mail aria-hidden="true" /><span><b>Updates where you need them</b><p>Email notifications bring you back to your private conversation.</p></span></div><div><ShieldCheck aria-hidden="true" /><span><b>Your details stay together</b><p>Include an order number so we can help with your specific purchase.</p></span></div></div>
        <Link className="support-inline-link" to="/account?tab=orders">Looking for order tracking? <ArrowRight size={16} aria-hidden="true" /></Link>
      </section>}

      <aside className="support-contact-card" id="new-support-request" aria-labelledby="support-compose-heading">
        <header className="support-compose-heading"><span className="support-compose-icon"><MessageSquareText aria-hidden="true" /></span><div><span className="eyebrow dark">CONTACT OUR TEAM</span><h2 id="support-compose-heading">{user ? confirmation ? "Request received" : "Start a private request" : "Sign in for private support"}</h2></div></header>
        {user ? confirmation ? <div className="support-receipt" ref={confirmationRef} tabIndex={-1} aria-labelledby="ticket-received-heading">
          <CheckCircle2 aria-hidden="true" /><h3 id="ticket-received-heading">Ticket received</h3><p>Your request has been saved. Our support team can now review it.</p>
          <dl><div><dt>Ticket number</dt><dd>{confirmation.ticket.ticket_number}</dd></div><div><dt>Subject</dt><dd>{confirmation.ticket.subject}</dd></div><div><dt>Status</dt><dd><TicketStatus status={tickets.find(item => item.id === confirmation.ticket.id)?.status || confirmation.ticket.status} /></dd></div></dl>
          <p>{confirmation.emailQueued ? "A confirmation email is queued for your verified email address. You can also track replies and status here." : "Track replies and status in Your conversations. Email notifications are currently unavailable; your ticket is safely saved."}</p>
          <DraftCaseImages draft={images} disabled={Boolean(busy)}/>
          <Link className="button button-dark full" to={`/support?ticket=${encodeURIComponent(confirmation.ticket.ticket_number)}`} onClick={event => { event.preventDefault(); trackTicket(confirmation.ticket); }}>Track this ticket <ArrowRight size={16} aria-hidden="true" /></Link>
          <button type="button" className="text-button" onClick={startRequest}>Start another request</button>
        </div> : <>
          <p className="support-compose-intro">Tell us how we can help. You can follow every update in your conversations.</p>
          <form onSubmit={submitTicket} noValidate aria-busy={busy === "new"}>
            <DraftCaseImages draft={images} disabled={Boolean(busy)}/>
            <label>What do you need help with?<select value={ticket.category} onChange={event => setTicket({ ...ticket, category: event.target.value })}><option value="order">Existing order</option><option value="product">Product question</option><option value="payment">Payment</option><option value="shipping">Shipping</option><option value="account">Account</option><option value="other">Something else</option></select></label>
            <label>Order number <span>(if applicable)</span><input name="order_number" maxLength={40} placeholder="G-100001" value={ticket.order_number} onChange={event => setTicket({ ...ticket, order_number: event.target.value.toUpperCase() })} /></label>
            <label>Short subject<input id="support-subject" name="subject" required minLength={4} maxLength={120} aria-invalid={formError?.field === "subject"} aria-describedby={formError?.field === "subject" ? "ticket-form-error" : undefined} placeholder="How can we help?" value={ticket.subject} onChange={event => setTicket({ ...ticket, subject: event.target.value })} /></label>
            <label htmlFor="support-new-message">Tell us what happened</label><textarea id="support-new-message" name="message" required minLength={10} maxLength={3000} rows={5} aria-invalid={formError?.field === "message"} aria-describedby={formError?.field === "message" ? "ticket-message-help ticket-form-error" : "ticket-message-help"} placeholder="Include the details that will help us understand your request." value={ticket.message} onChange={event => setTicket({ ...ticket, message: event.target.value })} />
            <div className="support-message-help" id="ticket-message-help"><span>At least 10 characters</span><span>{ticket.message.trim().length.toLocaleString()} / 3,000</span></div>
            <p className="support-compose-privacy"><LockKeyhole size={14} aria-hidden="true" /> Please keep passwords, card numbers, and bank credentials out of your message.</p>
            {formError && <div id="ticket-form-error" className="form-message error" role="alert">{formError.text}{[401, 403].includes(formError.status) && <Link to="/login?return=%2Fsupport">Sign in and verify your account</Link>}</div>}
            <button type="submit" className="button button-gold full" disabled={Boolean(busy)||images.busy}><Send size={16} aria-hidden="true" /> {busy === "new" ? "Submitting your request…" : "Create support ticket"}</button>
            {busy === "new" && <p className="support-submit-progress" role="status">Please wait while we save your ticket. You do not need to click again.</p>}
            <small>Keep your ticket number to track replies and status. Email updates link you back to your private conversation.</small>
          </form>
        </> : <div className="support-signin"><p>Sign in to keep your request, replies, and order details together securely.</p><Link className="button button-gold full" to={`/login?return=${encodeURIComponent("/support" + (params.toString() ? "?" + params.toString() : ""))}`}>Sign in to contact support <ArrowRight size={16} aria-hidden="true" /></Link><div className="support-signin-email"><span>Prefer email?</span><a href="mailto:support@goldonthespot.com">support@goldonthespot.com</a></div></div>}
      </aside>
    </div>

    <section className="support-quick-answers" aria-labelledby="support-faq-heading"><div className="container support-faq-layout">
      <div className="support-faq-intro"><span className="eyebrow dark">GOOD TO KNOW</span><h2 id="support-faq-heading">A few quick answers.</h2><p>Helpful details about orders, shipping, pricing, and your account.</p><a className="support-inline-link" href="#new-support-request">Still need a hand? <ArrowRight size={16} aria-hidden="true" /></a></div>
      <div className="faq-list">{supportFaqs.map(item => <article className={openFaq === item.id ? "open" : ""} key={item.id}><button type="button" id={`support-faq-${item.id}`} onClick={() => setOpenFaq(openFaq === item.id ? "" : item.id)} aria-expanded={openFaq === item.id} aria-controls={`support-answer-${item.id}`}><span><small>{item.category}</small>{item.question}</span><ChevronDown aria-hidden="true" /></button>{openFaq === item.id && <div id={`support-answer-${item.id}`} role="region" aria-labelledby={`support-faq-${item.id}`}><p>{item.answer}</p>{item.links.map(link => <Link key={link.to} to={link.to}>{link.label} <ArrowRight size={14} aria-hidden="true" /></Link>)}</div>}</article>)}</div>
    </div></section>
  </div>;
}
