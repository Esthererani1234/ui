import { useEffect, useState } from "react";
import { ChevronDown, Headphones, LockKeyhole, MessageSquareText, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { supportFaqs } from "../lib/supportKnowledge";
import { useAuth } from "../state/AuthContext";

const blankTicket = { category: "order", order_number: "", subject: "", message: "" };
const statusLabel = { open: "Awaiting support", in_progress: "Being reviewed", resolved: "Answered", closed: "Closed" };

export default function SupportPage() {
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState("live-pricing");
  const [tickets, setTickets] = useState([]);
  const [messages, setMessages] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [replies, setReplies] = useState({});
  const [ticket, setTicket] = useState(blankTicket);
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const loadTickets = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("support_tickets").select("id,ticket_number,category,order_number,subject,message,status,created_at,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false });
    setLoading(false);
    if (error) setNotice("We could not load your support history. Refresh and try again.");
    else setTickets(data || []);
  };
  const loadMessages = async (ticketId) => {
    const { data, error } = await supabase.from("support_ticket_messages").select("id,ticket_id,author_role,message,created_at").eq("ticket_id", ticketId).order("created_at");
    if (!error) setMessages((current) => ({ ...current, [ticketId]: data || [] }));
  };
  useEffect(() => { setTickets([]); setNotice(""); if (!user) { setLoading(false); return; } setLoading(true); loadTickets(); }, [user?.id]);
  const toggleTicket = async (id) => { const next = expanded === id ? null : id; setExpanded(next); if (next && !messages[id]) await loadMessages(id); };

  const submitTicket = async (event) => {
    event.preventDefault(); setBusy("new"); setNotice("");
    const payload = { user_id: user.id, category: ticket.category, order_number: ticket.order_number.trim() || null, subject: ticket.subject.trim(), message: ticket.message.trim() };
    const { error } = await supabase.from("support_tickets").insert(payload);
    setBusy("");
    if (error) return setNotice(error.message.includes("rate") ? error.message : "We could not create the ticket. Check the form and try again.");
    setTicket(blankTicket); setNotice("Ticket created. You can continue the conversation below."); await loadTickets();
  };
  const runAction = async (item, action) => {
    const key = `${action}-${item.id}`; setBusy(key); setNotice("");
    const { data, error } = await supabase.functions.invoke("support-operations", { body: { action, ticket_id: item.id, message: replies[item.id] || "" } });
    setBusy("");
    if (error || data?.error) return setNotice(data?.error || "That support action could not be completed.");
    setReplies((current) => ({ ...current, [item.id]: "" }));
    await Promise.all([loadTickets(), loadMessages(item.id)]);
    setExpanded(item.id);
    setNotice(action === "reply" ? "Reply sent securely." : action === "reopen" ? "Ticket reopened." : "Ticket closed.");
  };

  return <>
    <section className="support-hero"><div className="container"><span className="eyebrow">CUSTOMER CARE</span><h1>Help that stays with you.</h1><p>Ask a quick question, open a private request, and keep every reply together until the issue is resolved.</p><div><span><ShieldCheck /> Private ticket conversations</span><span><Headphones /> Human follow-up</span><span><LockKeyhole /> Email alerts without sensitive details</span></div></div></section>
    <section className="section support-section"><div className="container support-grid">
      <div><div className="section-heading"><div><span className="eyebrow dark">QUICK ANSWERS</span><h2>Before you open a ticket</h2><p>Common answers about pricing, payment, shipping, and accounts.</p></div></div><div className="faq-list">{supportFaqs.map((item) => <article className={openFaq === item.id ? "open" : ""} key={item.id}><button onClick={() => setOpenFaq(openFaq === item.id ? "" : item.id)} aria-expanded={openFaq === item.id}><span><small>{item.category}</small>{item.question}</span><ChevronDown /></button>{openFaq === item.id && <div><p>{item.answer}</p>{item.links.map((link) => <Link key={link.to} to={link.to}>{link.label} →</Link>)}</div>}</article>)}</div></div>
      <aside className="support-contact-card"><MessageSquareText /><span className="eyebrow dark">CONTACT SUPPORT</span><h2>{user ? "Start a private request" : "Sign in for private support"}</h2>{user ? <form onSubmit={submitTicket}><label>What do you need help with?<select value={ticket.category} onChange={(e) => setTicket({ ...ticket, category: e.target.value })}><option value="order">Existing order</option><option value="product">Product question</option><option value="payment">Payment</option><option value="shipping">Shipping</option><option value="account">Account</option><option value="other">Something else</option></select></label><label>Order number <span>(if applicable)</span><input maxLength="40" placeholder="GOTS-2026-…" value={ticket.order_number} onChange={(e) => setTicket({ ...ticket, order_number: e.target.value.toUpperCase() })} /></label><label>Short subject<input required minLength="4" maxLength="120" placeholder="Example: Question about my wire payment" value={ticket.subject} onChange={(e) => setTicket({ ...ticket, subject: e.target.value })} /></label><label>Tell us what happened<textarea required minLength="10" maxLength="3000" rows="6" placeholder="Include the details we need to help, but never send passwords or financial credentials." value={ticket.message} onChange={(e) => setTicket({ ...ticket, message: e.target.value })} /></label><button className="button button-gold full" disabled={busy === "new"}>{busy === "new" ? "Creating ticket…" : "Create support ticket"}</button><small>Support replies appear below and are also sent to your verified email when email delivery is configured.</small></form> : <><p>Sign in to keep your request, replies, and order details together securely.</p><Link className="button button-gold full" to="/login?return=/support">Sign in to contact support</Link><a className="support-email" href="mailto:support@goldonthespot.com">support@goldonthespot.com</a></>}</aside>
    </div></section>
    {user && <section className="section ticket-history-section"><div className="container"><div className="section-heading"><div><span className="eyebrow dark">SUPPORT INBOX</span><h2>Your conversations</h2><p>Open a ticket to read the full conversation, reply, close it, or reopen it.</p></div><span className="status-pill">{tickets.filter((item) => !["resolved", "closed"].includes(item.status)).length} active</span></div>{notice && <div className="form-message">{notice}</div>}{loading ? <div className="catalog-loading">Loading your private conversations…</div> : tickets.length ? <div className="support-inbox">{tickets.map((item) => <article className={`support-thread ${expanded === item.id ? "expanded" : ""}`} key={item.id}><button className="support-thread-summary" onClick={() => toggleTicket(item.id)}><div><small>{item.ticket_number} · {item.category}</small><h3>{item.subject}</h3><span>Updated {new Date(item.updated_at).toLocaleString()}</span></div><span className={`ticket-status ${item.status}`}>{statusLabel[item.status] || item.status}</span><ChevronDown /></button>{expanded === item.id && <div className="support-thread-body"><div className="support-messages">{(messages[item.id] || []).map((entry) => <div className={`support-message ${entry.author_role}`} key={entry.id}><b>{entry.author_role === "admin" ? "GoldOnTheSpot Support" : "You"}</b><p>{entry.message}</p><small>{new Date(entry.created_at).toLocaleString()}</small></div>)}</div><label className="support-reply-box">Reply<textarea rows="4" maxLength="5000" placeholder="Add a message to this conversation…" value={replies[item.id] || ""} onChange={(e) => setReplies((current) => ({ ...current, [item.id]: e.target.value }))} /></label><div className="support-thread-actions"><button className="button button-gold" onClick={() => runAction(item, "reply")} disabled={busy || !(replies[item.id] || "").trim()}><Send /> {busy === `reply-${item.id}` ? "Sending…" : "Send reply"}</button>{["resolved", "closed"].includes(item.status) ? <button className="button button-outline" onClick={() => runAction(item, "reopen")} disabled={busy}><RefreshCw /> Reopen ticket</button> : <button className="button button-outline" onClick={() => runAction(item, "close")} disabled={busy}><XCircle /> Close ticket</button>}</div></div>}</article>)}</div> : <div className="empty-state compact"><h3>No support conversations yet</h3><p>Use the form above when you need help. Your replies will stay organized here.</p></div>}</div></section>}
  </>;
}
