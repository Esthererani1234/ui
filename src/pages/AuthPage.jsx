import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatUsPhone, toUsE164 } from "../lib/phone";
import { useAuth } from "../state/AuthContext";
import SmsConsentDisclosure from "../components/SmsConsentDisclosure";

const friendlyError = (error, mode = "signin") => {
  const message = error?.message || "Something went wrong. Please try again.";
  if (/invalid login credentials/i.test(message)) return "The email or password is incorrect.";
  if (/already registered|already been registered/i.test(message)) return "An account already uses this information. Try signing in.";
  if (/signups? not allowed|user not found/i.test(message)) return mode === "signin" ? "We could not find an SMS account for that number. Create an account or use the existing-account option." : "We could not create that account.";
  if (/expired|invalid.*otp|token.*invalid/i.test(message)) return "That code is incorrect or expired. Request a new code and try again.";
  if (/rate limit|too many|over.*limit/i.test(message)) return "Too many code requests. Wait a few minutes and try again.";
  if (/email not confirmed/i.test(message)) return "Confirm your email before signing in.";
  if (/password/i.test(message)) return message;
  return "We could not complete that request. Please try again.";
};

const initialForm = { email: "", confirmEmail: "", phone: "", password: "", confirmPassword: "", firstName: "", lastName: "", agree: false };

export default function AuthPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const recoveryRequested = params.get("recovery") === "1";
  const [mode, setMode] = useState(recoveryRequested ? "recovery" : params.get("mode") === "signup" ? "signup" : "signin");
  const [stage, setStage] = useState("details");
  const [form, setForm] = useState(initialForm);
  const [pendingPhone, setPendingPhone] = useState("");
  const [code, setCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
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

  useEffect(() => {
    setMessage("");
    setMessageType("");
    setStage("details");
    setCode("");
    setResendSeconds(0);
  }, [mode]);

  useEffect(() => {
    if (!resendSeconds) return undefined;
    const timer = window.setInterval(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  if (user && mode !== "recovery") return <Navigate to={destination} replace />;

  const validateSignup = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return "Enter your first and last name.";
    const email = form.email.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
    if (email !== form.confirmEmail.trim().toLowerCase()) return "The email addresses do not match.";
    if (!form.agree) return "Agree to the Terms and Privacy Policy to create an account.";
    return "";
  };

  const sendSms = async (event) => {
    event?.preventDefault();
    const normalizedPhone = toUsE164(form.phone || pendingPhone);
    if (!normalizedPhone) return setMessage("Enter a valid 10-digit U.S. mobile number.");
    if (mode === "signup") {
      const validationMessage = validateSignup();
      if (validationMessage) return setMessage(validationMessage);
    }
    setBusy(true);
    setMessage("");
    setMessageType("");
    const email = form.email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: {
        shouldCreateUser: mode === "signup",
        ...(mode === "signup" ? { data: { first_name: form.firstName.trim(), last_name: form.lastName.trim(), phone: normalizedPhone, contact_email: email } } : {}),
      },
    });
    setBusy(false);
    if (error) return setMessage(friendlyError(error, mode));
    setPendingPhone(normalizedPhone);
    setCode("");
    setStage("code");
    setResendSeconds(30);
    setMessageType("success");
    setMessage(`We sent a six-digit code to ${formatUsPhone(normalizedPhone)}.`);
  };

  const verifySms = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessageType("");
      return setMessage("Enter the complete six-digit code.");
    }
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token: code, type: "sms" });
    if (error || !data.user) {
      setBusy(false);
      return setMessage(friendlyError(error, mode));
    }
    if (mode === "signup") {
      const details = { first_name: form.firstName.trim(), last_name: form.lastName.trim(), phone: pendingPhone, contact_email: form.email.trim().toLowerCase() };
      await Promise.all([
        supabase.auth.updateUser({ data: details }),
        supabase.from("profiles").update({ first_name: details.first_name, last_name: details.last_name, phone: details.phone }).eq("id", data.user.id),
      ]);
    }
    setBusy(false);
    navigate(destination, { replace: true });
  };

  const legacySignIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
    setBusy(false);
    if (error) setMessage(friendlyError(error));
  };

  const sendReset = async (event) => {
    event.preventDefault();
    if (!form.email.trim()) return setMessage("Enter your email address.");
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), { redirectTo: `${window.location.origin}/login?recovery=1` });
    setBusy(false);
    if (error) setMessage(friendlyError(error));
    else { setMessageType("success"); setMessage("If an existing account uses that email, a secure reset link has been sent."); }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    if (form.password.length < 12) return setMessage("Use at least 12 characters for the new password.");
    if (form.password !== form.confirmPassword) return setMessage("The passwords do not match.");
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password: form.password });
    setBusy(false);
    if (error) setMessage(friendlyError(error));
    else navigate("/account?tab=security", { replace: true });
  };

  const switchMode = (nextMode) => { setMode(nextMode); setForm(initialForm); setPendingPhone(""); };

  return <section className="auth-section"><div className="container auth-grid">
    <div className="auth-promise"><span className="eyebrow">SECURE CUSTOMER ACCOUNT</span><h1>Your bullion account, protected.</h1><p>See order totals, payment progress, fulfillment updates, saved delivery details, and private support requests in one place.</p><ul><li><ShieldCheck /> Your orders are visible only to you</li><li><Smartphone /> Password-free SMS sign-in</li><li><CheckCircle2 /> No full payment-card numbers stored here</li></ul></div>
    <div className="auth-card">
      {!["forgot", "recovery", "legacy"].includes(mode) && stage === "details" && <div className="auth-tabs"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => switchMode("signin")}>Sign in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Create account</button></div>}
      {mode === "forgot" ? <><div className="auth-card-heading"><LockKeyhole /><h2>Reset an existing password</h2><p>Only for accounts created before SMS sign-in.</p></div><form onSubmit={sendReset}><label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{message && <div className={`form-message ${messageType}`}>{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button><button type="button" className="text-button centered" onClick={() => switchMode("legacy")}>Back to existing-account sign in</button></form></>
      : mode === "recovery" ? <><div className="auth-card-heading"><LockKeyhole /><h2>Choose a new password</h2><p>This is only for an existing legacy account.</p></div><form onSubmit={updatePassword}><PasswordField label="New password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} /><PasswordField label="Confirm new password" value={form.confirmPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, confirmPassword: value })} />{message && <div className="form-message error">{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Updating securely…" : "Update password"}</button></form></>
      : mode === "legacy" ? <><button className="auth-back" type="button" onClick={() => switchMode("signin")}><ArrowLeft /> Back to SMS sign in</button><div className="auth-card-heading"><LockKeyhole /><h2>Existing account</h2><p>Use this once if your account was created with a password.</p></div><form onSubmit={legacySignIn}><label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><PasswordField label="Password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} autoComplete="current-password" minLength={8} />{message && <div className="form-message error">{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Signing in…" : "Sign in to existing account"}</button><button type="button" className="text-button centered" onClick={() => setMode("forgot")}>Forgot password?</button></form></>
      : stage === "code" ? <><button className="auth-back" type="button" onClick={() => { setStage("details"); setMessage(""); }}><ArrowLeft /> Change mobile number</button><Progress step={2} /><div className="auth-card-heading"><MessageSquareText /><h2>Enter your SMS code</h2><p>We sent it to <b>{formatUsPhone(pendingPhone)}</b>. The account opens only after this code is verified.</p></div><form onSubmit={verifySms}><label>Six-digit verification code<span className="auth-otp-input"><input required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></span></label>{message && <div className={`form-message ${messageType}`}>{message}</div>}<button className="button button-gold full" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : mode === "signup" ? "Verify & create account" : "Verify & sign in"}</button><button type="button" className="text-button centered" disabled={busy || resendSeconds > 0} onClick={sendSms}>{resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : "Send another code"}</button></form></>
      : <><Progress step={1} /><div className="auth-card-heading"><Smartphone /><h2>{mode === "signup" ? "Create your account" : "Sign in with SMS"}</h2><p>{mode === "signup" ? "Enter your details, then verify your mobile number." : "We’ll text a secure one-time code to your mobile number."}</p></div><form onSubmit={sendSms}>{mode === "signup" && <><div className="form-row"><label>First name<input required maxLength="60" autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label><label>Last name<input required maxLength="60" autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label></div><label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Re-enter email address<input required type="email" autoComplete="email" value={form.confirmEmail} onChange={(event) => setForm({ ...form, confirmEmail: event.target.value })} /></label></>}<label>Mobile number<span className="phone-input"><span aria-hidden="true">+1</span><input required type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(212) 555-0123" maxLength="14" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatUsPhone(event.target.value) })} /></span><small className="field-help">Your number becomes your secure, password-free sign-in.</small></label>{mode === "signup" && <label className="auth-agreement"><input type="checkbox" checked={form.agree} onChange={(event) => setForm({ ...form, agree: event.target.checked })} /> <span>I agree to the <Link to="/terms">Terms &amp; Conditions</Link> and <Link to="/privacy">Privacy Policy</Link>.</span></label>}{message && <div className={`form-message ${messageType || "error"}`}>{message}</div>}<button className="button button-gold full" disabled={busy}><MessageSquareText /> {busy ? "Sending securely…" : "Send verification code"}</button><SmsConsentDisclosure />{mode === "signin" && <button type="button" className="text-button centered legacy-link" onClick={() => switchMode("legacy")}>Account created with a password? Sign in here</button>}</form></>}
    </div>
  </div></section>;
}

function Progress({ step }) {
  return <div className="auth-progress" aria-label={`Step ${step} of 2`}><span className={step > 1 ? "done" : "active"}>{step > 1 ? <CheckCircle2 /> : <b>1</b>} Details</span><i /><span className={step === 2 ? "active" : ""}><b>2</b> Verify</span></div>;
}

function PasswordField({ label, value, onChange, show, onShow, autoComplete = "new-password", minLength = 12 }) {
  return <label>{label}<span className="password-input"><input required type={show ? "text" : "password"} minLength={minLength} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /><button type="button" onClick={onShow} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff /> : <Eye />}</button></span></label>;
}
