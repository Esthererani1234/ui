import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/pricing";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";

export default function CheckoutPage() {
  const { items, clear } = useCart();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: profile?.first_name || "", lastName: profile?.last_name || "", email: user?.email || "", phone: profile?.phone || "",
    address1: "", address2: "", city: "", state: "", postalCode: "", paymentMethod: "wire", notes: "",
  });

  const estimatedUnits = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  if (!items.length) return <Navigate to="/cart" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("create-order", {
      body: {
        cart: items.map((item) => ({ product_id: item.product.id, quantity: item.quantity })),
        contact: { first_name: form.firstName, last_name: form.lastName, email: form.email, phone: form.phone },
        shipping: { address_line_1: form.address1, address_line_2: form.address2, city: form.city, state: form.state.toUpperCase(), postal_code: form.postalCode, country: "US" },
        payment_method: form.paymentMethod,
        notes: form.notes,
      },
    });
    setBusy(false);
    if (invokeError || data?.error) return setError(data?.error || invokeError?.message || "Unable to place order.");
    clear();
    navigate(`/account?order=${encodeURIComponent(data.order_number)}`, { state: { newOrder: data } });
  };

  return (
    <section className="section checkout-section"><div className="container checkout-grid">
      <form className="checkout-form" onSubmit={submit}><div className="checkout-title"><span className="eyebrow dark">SECURE CHECKOUT</span><h1>Delivery and payment</h1><p>Your exact item prices are locked and inventory is reserved when you place the order.</p></div>
        <fieldset><legend>Contact</legend><div className="form-row"><label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label><label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label></div><div className="form-row"><label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Phone<input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label></div></fieldset>
        <fieldset><legend>Insured shipping address</legend><label>Street address<input required autoComplete="address-line1" value={form.address1} onChange={(e) => setForm({ ...form, address1: e.target.value })} /></label><label>Apartment, suite, etc. <span>(optional)</span><input autoComplete="address-line2" value={form.address2} onChange={(e) => setForm({ ...form, address2: e.target.value })} /></label><div className="form-row three"><label>City<input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label><label>State<input required maxLength={2} placeholder="NY" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></label><label>ZIP code<input required inputMode="numeric" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} /></label></div></fieldset>
        <fieldset><legend>Payment method</legend><div className="payment-options"><label className={form.paymentMethod === "wire" ? "selected" : ""}><input type="radio" name="payment" value="wire" checked={form.paymentMethod === "wire"} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} /><span><b>Bank wire</b><small>Instructions provided after review • no surcharge</small></span></label><label className={form.paymentMethod === "ach" ? "selected" : ""}><input type="radio" name="payment" value="ach" checked={form.paymentMethod === "ach"} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} /><span><b>ACH transfer</b><small>Instructions provided after review • no surcharge</small></span></label><label className={form.paymentMethod === "check" ? "selected" : ""}><input type="radio" name="payment" value="check" checked={form.paymentMethod === "check"} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} /><span><b>Certified check</b><small>Ships after funds clear • no surcharge</small></span></label><label className={form.paymentMethod === "card" ? "selected" : ""}><input type="radio" name="payment" value="card" checked={form.paymentMethod === "card"} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} /><span><b>Credit card invoice</b><small>Secure invoice follows review • 4% processing surcharge</small></span></label></div></fieldset>
        <label>Order notes <span>(optional)</span><textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Delivery or product notes" /></label>{error && <div className="form-message error">{error}</div>}<button className="button button-gold full large" disabled={busy}>{busy ? "Locking price and inventory…" : "Place secure order"}</button><p className="secure-submit"><LockKeyhole size={16} /> By placing the order, you agree to the Terms. No card information is collected on this page.</p>
      </form>
      <aside className="checkout-summary"><h2>Order review</h2><span>{estimatedUnits} item{estimatedUnits === 1 ? "" : "s"}</span>{items.map((item) => <div className="checkout-item" key={item.product.id}><div className={`cart-thumb small ${item.product.metal}`}>{item.product.metal === "gold" ? "Au" : item.product.metal === "silver" ? "Ag" : "Pt"}</div><span><b>{item.product.name}</b><small>Quantity {item.quantity}</small></span></div>)}<div className="checkout-notice"><CheckCircle2 /><span><b>Price protection</b><small>The server—not your browser—recalculates every line using current spot pricing.</small></span></div><p className="checkout-estimate">Your final locked total will appear immediately after submission. Estimated cart quantities: <b>{estimatedUnits}</b>.</p></aside>
    </div></section>
  );
}
