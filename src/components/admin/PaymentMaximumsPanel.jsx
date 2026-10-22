import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { invokeFunction } from "../../lib/functionRequest";

const fields = [["card_order_maximum", "Card maximum ($)"], ["wire_order_maximum", "Wire maximum ($)"], ["crypto_order_maximum", "Crypto maximum ($)"]];

export default function PaymentMaximumsPanel() {
  const [limits, setLimits] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    setMessage("");
    const { data, error } = await supabase.from("app_settings").select("key,value").in("key", fields.map(([key]) => key));
    const values = Object.fromEntries((data || []).map(row => [row.key, row.value]));
    if (error || fields.some(([key]) => !Number.isFinite(values[key]))) {
      setMessage("Payment maximums could not be loaded. Try again.");
      return;
    }
    setLimits(values);
  };
  useEffect(() => { load(); }, []);
  const save = async event => {
    event.preventDefault();
    if (busy || !limits) return;
    const values = Object.fromEntries(fields.map(([key]) => [key, Number(limits[key])]));
    if (fields.some(([key]) => !/^\d+(\.\d{1,2})?$/.test(String(limits[key])) || values[key] < 1 || values[key] > 10000000)) {
      setMessage("Enter maximums from $1 to $10,000,000 with at most two decimal places."); return;
    }
    if (reason.trim().length < 3) { setMessage("Enter a reason for this change."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await invokeFunction(supabase, "admin-operations", { action: "update_payment_maximums", limits: values, reason: reason.trim() });
      setLimits(result.limits); setReason("");
      setMessage("Payment maximums saved and recorded in the audit log.");
    } catch (error) {
      setMessage(error.message || "Maximums could not be saved. Your changes are still here.");
    } finally { setBusy(false); }
  };
  return <form className="admin-panel store-settings-panel" onSubmit={save} noValidate>
    <div className="panel-title"><div><h2>Payment order maximums</h2><p>Set the largest final order total allowed for each payment method.</p></div></div>
    {limits ? <>
      <div className="form-row">{fields.map(([key, label]) => <label key={key}>{label}<input required type="number" inputMode="decimal" min="1" max="10000000" step="0.01" disabled={busy} value={limits[key]} onChange={event => setLimits(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
      <p className="field-help">USD totals include shipping and payment fees. Limits apply to new orders, changed payment methods, and repriced orders. Existing orders are not cancelled. These settings do not enable a payment provider.</p>
      <label>Reason for payment limit change<textarea required minLength="3" maxLength="1000" rows="2" disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button className="button button-dark" disabled={busy}><Save /> {busy ? "Saving maximums…" : "Save payment maximums"}</button>
    </> : <button type="button" className="text-button" onClick={load}>Reload payment maximums</button>}
    {message && <div className="form-message" role="status">{message}</div>}
  </form>;
}
