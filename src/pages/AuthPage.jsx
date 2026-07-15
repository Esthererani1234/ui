import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../state/AuthContext";

export default function AuthPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const destination = params.get("return") || "/account";

  useEffect(() => setMessage(""), [mode]);
  if (user) return <Navigate to={destination} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage("");
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { first_name: form.firstName, last_name: form.lastName }, emailRedirectTo: `${window.location.origin}/account` } })
      : await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account, then sign in.");
  };

  const resetPassword = async () => {
    if (!form.email) return setMessage("Enter your email address first.");
    const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: `${window.location.origin}/account` });
    setMessage(error ? error.message : "Password reset instructions were sent.");
  };

  return (
    <section className="auth-section"><div className="container auth-grid">
      <div className="auth-promise"><span className="eyebrow">SECURE CUSTOMER ACCOUNT</span><h1>Track every order with confidence.</h1><p>Your account keeps order status, payment instructions, and fulfillment updates together in one protected place.</p><ul><li><LockKeyhole /> Secure Supabase authentication</li><li><LockKeyhole /> Your orders are visible only to you</li><li><LockKeyhole /> No payment card numbers stored here</li></ul></div>
      <div className="auth-card"><div className="auth-tabs"><button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button></div><form onSubmit={submit}>{mode === "signup" && <div className="form-row"><label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label><label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label></div>}<label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Password<input required type="password" minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>{message && <div className="form-message">{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create secure account" : "Sign in"}</button>{mode === "signin" && <button type="button" className="text-button centered" onClick={resetPassword}>Forgot password?</button>}</form></div>
    </div></section>
  );
}
