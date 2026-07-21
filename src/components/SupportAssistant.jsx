import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

const prompts = ["What are live prices?", "How does shipping work?", "Where is my order?", "Payment options"];

export default function SupportAssistant() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", text: "Hi—I’m the private Gold Assistant. I can explain live pricing, products, payment, shipping, accounts, and order support.", links: [] }]);
  const logRef = useRef(null);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const ask = async (value) => {
    const question = value.trim().slice(0, 800);
    if (!question || busy) return;
    const pendingId = crypto.randomUUID();
    setMessages((current) => [...current, { role: "user", text: question, links: [] }, { id: pendingId, role: "assistant", text: "Thinking…", links: [], pending: true }].slice(-20));
    setInput("");
    setBusy(true);
    try {
      const history = messages.slice(-8).map((message) => ({ role: message.role, content: message.text }));
      const { data: result, error } = await supabase.functions.invoke("store-assistant", { body: { message: question, history } });
      if (error || !result?.answer) throw error || new Error("Assistant unavailable");
      const links = Array.isArray(result.links) ? result.links.filter((link) => typeof link?.to === "string" && link.to.startsWith("/")).slice(0, 3) : [];
      setMessages((current) => [...current.filter((message) => message.id !== pendingId), { role: "assistant", text: result.answer, links }].slice(-20));
    } catch {
      setMessages((current) => [...current.filter((message) => message.id !== pendingId), { role: "assistant", text: "I’m having trouble connecting right now. Please try again in a moment or contact support.", links: [{ label: "Contact support", to: "/support" }] }].slice(-20));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button className="assistant-launcher" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close Gold Assistant" : "Open Gold Assistant"} aria-expanded={open}><Sparkles /><span>Ask Gold Assistant</span></button>
    {open && <section className="assistant-panel" aria-label="Gold Assistant" role="dialog">
      <header><span><Bot /><b>Gold Assistant</b><small>Live product guidance • private session</small></span><button onClick={() => setOpen(false)} aria-label="Close assistant"><X /></button></header>
      <div className="assistant-log" ref={logRef} aria-live="polite">{messages.map((message, index) => <div className={`assistant-message ${message.role}${message.pending ? " pending" : ""}`} key={message.id || `${message.role}-${index}`}><p>{message.text}</p>{message.links?.length > 0 && <div>{message.links.map((link) => <Link key={`${link.to}-${link.label}`} to={link.to}>{link.label} →</Link>)}</div>}</div>)}</div>
      {messages.length === 1 && <div className="assistant-prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>}
      <form onSubmit={(event) => { event.preventDefault(); ask(input); }}><input value={input} onChange={(event) => setInput(event.target.value)} maxLength="800" placeholder="Ask a detailed product or order question…" aria-label="Ask Gold Assistant" disabled={busy} /><button disabled={busy || !input.trim()} aria-label="Send question"><Send /></button></form>
      <footer>Never share passwords, verification codes, card numbers, or bank credentials in chat.</footer>
    </section>}
  </>;
}
