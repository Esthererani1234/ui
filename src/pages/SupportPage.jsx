import { useEffect, useState } from "react";
import { ChevronDown, Headphones, LockKeyhole, MessageSquareText, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { supportFaqs } from "../lib/supportKnowledge";
import { useAuth } from "../state/AuthContext";

const blankTicket = { category: "order", order_number: "", subject: "", message: "" };

export default function SupportPage() {
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState("live-pricing");
  const [tickets, setTickets] = useState([]);
  const [ticket, setTicket] = useState(blankTicket);
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadTickets = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("support_tickets").select("id, ticket_number, category, order_number, subject, message, status, admin_response, created_at, updated_at").eq("user_id", user.id).order("created_at", { ascending: false });
    setLoading(false);
    if (error) setNotice("We could not load your support history. Please try again.");
    else setTickets(data || []);
  };
  useEffect(() => {
    setTickets([]);
    setNotice("");
    if (!user) { setLoading(false); return; }
    setLoading(true);
    loadTickets();
  }, [user?.id]);

  const submitTicket = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice("");
    const payload = {
      user_id: user.id,
      category: ticket.category,
      order_number: ticket.order_number.trim() || null,
      subject: ticket.subject.trim(),
      message: ticket.message.trim(),
    };
    const { error } = await supabase.from("support_tickets").insert(payload);
    setBusy(false);
    if (error) return setNotice(error.message.includes("rate") ? error.message : "We could not create the ticket. Please check the form and try again.");
    setTicket(blankTicket); setNotice("Your private support ticket was created."); await loadTickets();
  };

  return <>
    <section className="support-hero"><div className="container"><span className="eyebrow">CUSTOMER CARE</span><h1>Clear answers. Private help.</h1><p>Start with a quick answer below, ask the local Gold Assistant, or open a secure ticket tied to your account.</p><div><span><ShieldCheck /> Private account tickets</span><span><Headphones /> Human follow-up</span><span><LockKeyhole /> Never send payment credentials</span></div></div></section>
    <section className="section support-section"><div className="container support-grid">
      <div><div className="section-heading"><div><span className="eyebrow dark">HELP CENTER</span><h2>Frequently asked questions</h2></div></div><div className="faq-list">{supportFaqs.map((item) => <article className={openFaq === item.id ? "open" : ""} key={item.id}><button onClick={() => setOpenFaq(openFaq === item.id ? "" : item.id)} aria-expanded={openFaq === item.id}><span><small>{item.category}</small>{item.question}</span><ChevronDown /></button>{openFaq === item.id && <div><p>{item.answer}</p>{item.links.map((link) => <Link key={link.to} to={link.to}>{link.label} →</Link>)}</div>}</article>)}</div></div>
      <aside className="support-contact-card"><MessageSquareText /><span className="eyebrow dark">PRIVATE SUPPORT</span><h2>{user ? "Open a support ticket" : "Sign in for private support"}</h2>{user ? <form onSubmit={submitTicket}><label>Topic<select value={ticket.category} onChange={(event) => setTicket({ ...ticket, category: event.target.value })}><option value="order">Existing order</option><option value="product">Product question</option><option value="payment">Payment</option><option value="shipping">Shipping</option><option value="account">Account</option><option value="other">Other</option></select></label><label>Order number <span>(optional)</span><input maxLength="40" placeholder="GOTS-2026-…" value={ticket.order_number} onChange={(event) => setTicket({ ...ticket, order_number: event.target.value.toUpperCase() })} /></label><label>Subject<input required minLength="4" maxLength="120" value={ticket.subject} onChange={(event) => setTicket({ ...ticket, subject: event.target.value })} /></label><label>How can we help?<textarea required minLength="10" maxLength="3000" rows="6" value={ticket.message} onChange={(event) => setTicket({ ...ticket, message: event.target.value })} /></label>{notice && <div className="form-message">{notice}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Sending securely…" : "Create ticket"}</button><small>Do not include passwords, full card numbers, bank credentials, or government ID numbers.</small></form> : <><p>Sign in to create a ticket that only you and the verified administrator can read.</p><Link className="button button-gold full" to="/login?return=/support">Sign in to contact support</Link><a className="support-email" href="mailto:support@goldonthespot.com">Or email support@goldonthespot.com</a></>}
      </aside>
    </div></section>
    {user && <section className="section ticket-history-section"><div className="container"><div className="section-heading"><div><span className="eyebrow dark">YOUR REQUESTS</span><h2>Support history</h2></div></div>{loading ? <div className="catalog-loading">Loading your private tickets…</div> : tickets.length ? <div className="ticket-list">{tickets.map((item) => <article key={item.id}><header><div><small>{item.ticket_number}</small><h3>{item.subject}</h3></div><span className={`ticket-status ${item.status}`}>{item.status.replace("_", " ")}</span></header><p>{item.message}</p>{item.order_number && <small>Order: {item.order_number}</small>}{item.admin_response && <div className="ticket-response"><b>GoldOnTheSpot response</b><p>{item.admin_response}</p></div>}<footer>Opened {new Date(item.created_at).toLocaleString()}</footer></article>)}</div> : <div className="empty-state compact"><h3>No support tickets</h3><p>Your private requests and replies will appear here.</p></div>}</div></section>}
  </>;
}
