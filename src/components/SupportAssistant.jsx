import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getLocalSupportAnswer } from "../lib/supportKnowledge";
import { useAuth } from "../state/AuthContext";

const prompts = ["What are live prices?", "How does shipping work?", "Where is my order?", "Payment options"];

export default function SupportAssistant() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [products, setProducts] = useState([]);
  const [spot, setSpot] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", text: "Hi—I’m the private Gold Assistant. I can explain live pricing, products, payment, shipping, accounts, and order support.", links: [] }]);
  const logRef = useRef(null);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open || loaded) return;
    let active = true;
    Promise.all([
      supabase.from("products").select("id, slug, name, metal, metal_weight_oz, premium_percent, premium_fixed, price_mode, fixed_price, inventory_count, is_active").eq("is_active", true).order("sort_order"),
      fetch(`/api/metals?t=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
    ]).then(([catalog, market]) => {
      if (!active) return;
      setProducts(catalog.data || []);
      setSpot(market?.metals || null);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [open, loaded]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const ask = (value) => {
    const question = value.trim().slice(0, 400);
    if (!question) return;
    const answer = getLocalSupportAnswer(question, { products, spot, signedIn: Boolean(user) });
    setMessages((current) => [...current, { role: "user", text: question, links: [] }, { role: "assistant", ...answer }].slice(-20));
    setInput("");
  };

  return <>
    <button className="assistant-launcher" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close Gold Assistant" : "Open Gold Assistant"} aria-expanded={open}><Sparkles /><span>Ask Gold Assistant</span></button>
    {open && <section className="assistant-panel" aria-label="Gold Assistant" role="dialog">
      <header><span><Bot /><b>Gold Assistant</b><small>Private, local answers • no AI account needed</small></span><button onClick={() => setOpen(false)} aria-label="Close assistant"><X /></button></header>
      <div className="assistant-log" ref={logRef} aria-live="polite">{messages.map((message, index) => <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><p>{message.text}</p>{message.links?.length > 0 && <div>{message.links.map((link) => <Link key={`${link.to}-${link.label}`} to={link.to}>{link.label} →</Link>)}</div>}</div>)}</div>
      {messages.length === 1 && <div className="assistant-prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>}
      <form onSubmit={(event) => { event.preventDefault(); ask(input); }}><input value={input} onChange={(event) => setInput(event.target.value)} maxLength="400" placeholder="Ask about prices, products, shipping…" aria-label="Ask Gold Assistant" /><button disabled={!input.trim()} aria-label="Send question"><Send /></button></form>
      <footer>For general help only. Never share passwords, card numbers, or bank credentials.</footer>
    </section>}
  </>;
}
