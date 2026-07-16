import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { metalSymbol, money, productPrice } from "../lib/pricing";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";

const defaults = { shipping_flat: 35, free_shipping_threshold: 5000, card_surcharge_percent: 4, accepting_orders: true };

export default function CheckoutPage() {
  const { items, clear, reconcileProducts } = useCart();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [spot, setSpot] = useState(null);
  const [cartReady, setCartReady] = useState(false);
  const [settings, setSettings] = useState(defaults);
  const [form, setForm] = useState({ firstName: profile?.first_name || "", lastName: profile?.last_name || "", phone: profile?.phone || "", address1: profile?.address_line_1 || "", address2: profile?.address_line_2 || "", city: profile?.city || "", state: profile?.state || "", postalCode: profile?.postal_code || "", paymentMethod: "wire", notes: "", saveAddress: true, agree: false });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/metals?t=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
      supabase.from("app_settings").select("key, value").in("key", ["shipping_flat", "free_shipping_threshold", "card_surcharge_percent", "accepting_orders"]),
    ]).then(([market, settingResult]) => {
      if (!active) return;
      setSpot(market?.metals || null);
      const next = { ...defaults };
      for (const row of settingResult.data || [])
        next[row.key] = row.key === "accepting_orders" ? Boolean(row.value) : Number(row.value);
      setSettings(next);
    });
    return () => { active = false; };
  }, []);
  const itemIds = useMemo(() => items.map((item) => item.product.id).sort((a, b) => a - b).join(","), [items]);
  useEffect(() => {
    if (!itemIds) { setCartReady(true); return; }
    setCartReady(false);
    const ids = itemIds.split(",").map(Number);
    supabase.from("products").select("*").in("id", ids).then(({ data, error: catalogError }) => {
      if (catalogError) setError("Current inventory could not be refreshed. Checkout will still verify it on the server.");
      else reconcileProducts(data || []);
      setCartReady(true);
    });
  }, [itemIds]);

  const estimate = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + (productPrice(item.product, spot) || 0) * item.quantity, 0);
    const shipping = subtotal >= settings.free_shipping_threshold ? 0 : settings.shipping_flat;
    const surcharge = form.paymentMethod === "card" ? subtotal * settings.card_surcharge_percent / 100 : 0;
    return { subtotal, shipping, surcharge, total: subtotal + shipping + surcharge };
  }, [items, spot, settings, form.paymentMethod]);
  const estimatedUnits = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  if (!items.length) return <Navigate to="/cart" replace />;

  const submit = async (event) => {
    event.preventDefault();
    if (!settings.accepting_orders) return setError("Checkout is temporarily paused. Your cart is saved; please try again later.");
    if (!/^[A-Za-z]{2}$/.test(form.state.trim())) return setError("Enter a two-letter US state code.");
    if (!/^\d{5}(?:-\d{4})?$/.test(form.postalCode.trim())) return setError("Enter a valid US ZIP code.");
    if (!form.agree) return setError("Agree to the Terms of Purchase before placing the order.");
    setBusy(true); setError("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("create-order", { body: { cart: items.map((item) => ({ product_id: item.product.id, quantity: item.quantity })), contact: { first_name: form.firstName.trim(), last_name: form.lastName.trim(), email: user.email, phone: form.phone.trim() }, shipping: { address_line_1: form.address1.trim(), address_line_2: form.address2.trim(), city: form.city.trim(), state: form.state.trim().toUpperCase(), postal_code: form.postalCode.trim(), country: "US" }, payment_method: form.paymentMethod, notes: form.notes.trim() } });
      if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || "Unable to place order.");
      if (form.saveAddress) {
        await supabase.from("profiles").update({ first_name: form.firstName.trim(), last_name: form.lastName.trim(), phone: form.phone.trim(), address_line_1: form.address1.trim(), address_line_2: form.address2.trim() || null, city: form.city.trim(), state: form.state.trim().toUpperCase(), postal_code: form.postalCode.trim() }).eq("id", user.id);
        await refreshProfile();
      }
      clear();
      navigate(`/account?order=${encodeURIComponent(data.order_number)}&tab=orders`, { state: { newOrder: data } });
    } catch (submitError) {
      setError(submitError.message || "Unable to place the order. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="section checkout-section"><div className="container checkout-grid">
    <form className="checkout-form" onSubmit={submit}><div className="checkout-title"><span className="eyebrow dark">SECURE CHECKOUT</span><h1>Delivery and payment</h1><p>Review your verified contact information and insured-delivery address.</p></div>
      <fieldset><legend>Contact</legend><div className="form-row"><label>First name<input required maxLength="60" autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label><label>Last name<input required maxLength="60" autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label></div><div className="form-row"><label>Verified email<input disabled value={user.email} /></label><label>Phone<input required type="tel" maxLength="30" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label></div></fieldset>
      <fieldset><legend>Insured shipping address</legend><label>Street address<input required maxLength="160" autoComplete="address-line1" value={form.address1} onChange={(event) => setForm({ ...form, address1: event.target.value })} /></label><label>Apartment, suite, etc. <span>(optional)</span><input maxLength="100" autoComplete="address-line2" value={form.address2} onChange={(event) => setForm({ ...form, address2: event.target.value })} /></label><div className="form-row three"><label>City<input required maxLength="80" autoComplete="address-level2" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label><label>State<input required maxLength="2" autoComplete="address-level1" placeholder="NY" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></label><label>ZIP code<input required maxLength="10" inputMode="numeric" autoComplete="postal-code" value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></label></div><label className="checkout-check"><input type="checkbox" checked={form.saveAddress} onChange={(event) => setForm({ ...form, saveAddress: event.target.checked })} /> Save this as my default delivery address</label></fieldset>
      <fieldset><legend>Payment method</legend><div className="payment-options"><PaymentOption value="wire" form={form} setForm={setForm} title="Bank wire" detail="Instructions provided after review • no surcharge" /><PaymentOption value="ach" form={form} setForm={setForm} title="ACH transfer" detail="Instructions provided after review • no surcharge" /><PaymentOption value="check" form={form} setForm={setForm} title="Certified check" detail="Ships after cleared funds • no surcharge" /><PaymentOption value="card" form={form} setForm={setForm} title="Credit card invoice" detail={`Secure invoice follows review • ${settings.card_surcharge_percent}% processing surcharge`} /></div></fieldset>
      <label>Order notes <span>(optional)</span><textarea rows="3" maxLength="1000" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Delivery or product notes" /></label><label className="checkout-check terms-check"><input type="checkbox" checked={form.agree} onChange={(event) => setForm({ ...form, agree: event.target.checked })} /> I agree to the <Link to="/terms">Terms of Purchase</Link> and understand that bullion prices fluctuate.</label>{!settings.accepting_orders && <div className="form-message error">Checkout is temporarily paused. Your cart will stay saved.</div>}{error && <div className="form-message error">{error}</div>}<button className="button button-gold full large" disabled={busy || !spot || !cartReady || !settings.accepting_orders}>{busy ? "Locking price and inventory…" : !settings.accepting_orders ? "Checkout temporarily paused" : !cartReady ? "Refreshing inventory…" : !spot ? "Loading live prices…" : "Place secure order"}</button><p className="secure-submit"><LockKeyhole /> Checkout recalculates prices and inventory on the server. No card information is collected here.</p>
    </form>
    <aside className="checkout-summary"><h2>Order review</h2><span>{estimatedUnits} item{estimatedUnits === 1 ? "" : "s"}</span>{items.map((item) => { const price = productPrice(item.product, spot); return <div className="checkout-item" key={item.product.id}><div className={`cart-thumb small ${item.product.metal}`}>{metalSymbol(item.product.metal)}</div><span><b>{item.product.name}</b><small>{item.quantity} × {price == null ? "Loading live price…" : money(price)}</small></span><strong>{price == null ? "—" : money(price * item.quantity)}</strong></div>; })}<div className="checkout-totals"><div><span>Live-priced items</span><b>{spot ? money(estimate.subtotal) : "Loading…"}</b></div><div><span>Insured shipping</span><b>{estimate.shipping ? money(estimate.shipping) : "Free"}</b></div>{estimate.surcharge > 0 && <div><span>Card surcharge</span><b>{money(estimate.surcharge)}</b></div>}<div><span>Estimated total</span><strong>{spot ? money(estimate.total) : "—"}</strong></div></div><div className="checkout-notice"><CheckCircle2 /><span><b>Final price protection</b><small>The server—not your browser—recalculates every line at submission. The confirmation shows the exact locked total.</small></span></div></aside>
  </div></section>;
}

function PaymentOption({ value, form, setForm, title, detail }) {
  return <label className={form.paymentMethod === value ? "selected" : ""}><input type="radio" name="payment" value={value} checked={form.paymentMethod === value} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} /><span><b>{title}</b><small>{detail}</small></span></label>;
}
