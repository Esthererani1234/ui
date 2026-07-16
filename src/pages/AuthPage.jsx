import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../state/AuthContext";

const friendlyError = (error) => {
  const message = error?.message || "Something went wrong. Please try again.";
  if (/invalid login credentials/i.test(message)) return "The email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirm your email from the message we sent before signing in.";
  if (/user already registered/i.test(message)) return "An account may already exist for that email. Try signing in or resetting the password.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a few minutes and try again.";
  if (/password/i.test(message)) return message;
  return "We could not complete that request. Please try again.";
};

export default function AuthPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const recoveryRequested = params.get("recovery") === "1";
  const [mode, setMode] = useState(recoveryRequested ? "recovery" : params.get("mode") === "signup" ? "signup" : "signin");
  const [form, setForm] = useState({ email: "", phone: "", password: "", confirmPassword: "", firstName: "", lastName: "", agree: false });
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const rawDestination = params.get("return") || "/account";
  const destination = rawDestination.startsWith("/") && !rawDestination.startsWith("//") ? rawDestination : "/account";

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { setMessage(""); setMessageType(""); }, [mode]);

  if (user && mode !== "recovery") return <Navigate to={destination} replace />;

  const submit = async (event) => {
    event.preventDefault();
    if (mode === "signup" && (!form.firstName.trim() || !form.lastName.trim())) return setMessage("Enter your first and last name.");
    const normalizedPhone = form.phone.replace(/[\s()-]/g, "");
    if (mode === "signup" && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) return setMessage("Enter a mobile number with country code, such as +12125550123.");
    if (mode === "signup" && form.password !== form.confirmPassword) return setMessage("The passwords do not match.");
    if (mode === "signup" && !form.agree) return setMessage("Agree to the Terms and Privacy Policy to create an account.");
    setBusy(true); setMessage(""); setMessageType("");
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email: form.email.trim(), password: form.password, options: { data: { first_name: form.firstName.trim(), last_name: form.lastName.trim(), phone: normalizedPhone }, emailRedirectTo: `${window.location.origin}${destination}` } })
      : await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
    setBusy(false);
    if (result.error) setMessage(friendlyError(result.error));
    else if (mode === "signup" && !result.data.session) { setMessageType("success"); setMessage("Check your email for the GoldOnTheSpot confirmation message. After confirming, sign in and complete SMS security."); }
  };

  const sendReset = async (event) => {
    event.preventDefault();
    if (!form.email.trim()) return setMessage("Enter your email address.");
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), { redirectTo: `${window.location.origin}/login?recovery=1` });
    setBusy(false);
    if (error) setMessage(friendlyError(error));
    else { setMessageType("success"); setMessage("If an account exists for that email, a secure password-reset link has been sent."); }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    if (form.password.length < 12) return setMessage("Use at least 12 characters for the new password.");
    if (form.password !== form.confirmPassword) return setMessage("The passwords do not match.");
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.updateUser({ password: form.password });
    setBusy(false);
    if (error) setMessage(friendlyError(error));
    else navigate("/account?tab=security", { replace: true });
  };

  return <section className="auth-section"><div className="container auth-grid">
    <div className="auth-promise"><span className="eyebrow">SECURE CUSTOMER ACCOUNT</span><h1>Your bullion account, protected.</h1><p>See order totals, payment progress, fulfillment updates, saved delivery details, and private support requests in one place.</p><ul><li><ShieldCheck /> Your orders are visible only to you</li><li><LockKeyhole /> Password plus SMS identity protection</li><li><CheckCircle2 /> No full payment-card numbers stored here</li></ul></div>
    <div className="auth-card">
      {mode !== "forgot" && mode !== "recovery" && <div className="auth-tabs"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button></div>}
      {mode === "forgot" ? <><div className="auth-card-heading"><Mail /><h2>Reset your password</h2><p>We will email a one-time secure link.</p></div><form onSubmit={sendReset}><label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{message && <div className={`form-message ${messageType}`}>{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button><button type="button" className="text-button centered" onClick={() => setMode("signin")}>Back to sign in</button></form></>
      : mode === "recovery" ? <><div className="auth-card-heading"><LockKeyhole /><h2>Choose a new password</h2><p>Use a unique password with at least 12 characters.</p></div><form onSubmit={updatePassword}><PasswordField label="New password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} /><PasswordField label="Confirm new password" value={form.confirmPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, confirmPassword: value })} />{message && <div className="form-message error">{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Updating securely…" : "Update password"}</button></form></>
      : <form onSubmit={submit}>{mode === "signup" && <div className="form-row"><label>First name<input required maxLength="60" autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label><label>Last name<input required maxLength="60" autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label></div>}<label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{mode === "signup" && <label>Mobile number<input required type="tel" autoComplete="tel" placeholder="+12125550123" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><small className="field-help">Required for SMS identity verification. Include the country code.</small></label>}<PasswordField label="Password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 8} />{mode === "signup" && <><PasswordField label="Confirm password" value={form.confirmPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, confirmPassword: value })} autoComplete="new-password" minLength={12} /><label className="auth-agreement"><input type="checkbox" checked={form.agree} onChange={(event) => setForm({ ...form, agree: event.target.checked })} /> <span>I agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</span></label></>}{message && <div className={`form-message ${messageType || "error"}`}>{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create secure account" : "Sign in securely"}</button>{mode === "signin" && <button type="button" className="text-button centered" onClick={() => setMode("forgot")}>Forgot password?</button>}</form>}
    </div>
  </div></section>;
}

function PasswordField({ label, value, onChange, show, onShow, autoComplete = "new-password", minLength = 12 }) {
  return <label>{label}<span className="password-input"><input required type={show ? "text" : "password"} minLength={minLength} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /><button type="button" onClick={onShow} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff /> : <Eye />}</button></span><small className="field-help">{minLength >= 12 ? "At least 12 characters; use a password you do not use elsewhere." : "Enter your account password."}</small></label>;
}
