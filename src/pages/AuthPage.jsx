import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatUsPhone, toUsE164 } from "../lib/phone";
import { useAuth } from "../state/AuthContext";
import SmsConsentDisclosure from "../components/SmsConsentDisclosure";
import { getCustomerSmsStatus, sendCustomerSmsCode, updatePasswordAfterSms, verifyCustomerSmsCode } from "../lib/customerSms";

const initialForm = { email: "", confirmEmail: "", phone: "", password: "", confirmPassword: "", firstName: "", lastName: "", agree: false };

const friendlyError = (error) => {
  const message = error?.message || "Something went wrong. Please try again.";
  if (/invalid login credentials/i.test(message)) return "The email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Enter the verification code sent to your email before signing in.";
  if (/already registered|already been registered/i.test(message)) return "An account may already exist for that email. Try signing in or resetting the password.";
  if (/expired|invalid.*otp|token.*invalid/i.test(message)) return "That code is incorrect or expired. Request a new code and try again.";
  if (/security code|SMS security|MessageBird|mobile number/i.test(message)) return message;
  if (/rate limit|too many|over.*limit/i.test(message)) return "Too many attempts. Wait a few minutes and try again.";
  if (/password/i.test(message)) return message;
  return "We could not complete that request. Please try again.";
};

const isEmailSendRateLimit = (error) =>
  error?.status === 429 || error?.code === "over_email_send_rate_limit" || /email.*rate|rate.*email|request this after/i.test(error?.message || "");

const emailRetrySeconds = (error) => {
  const seconds = Number((error?.message || "").match(/(?:after|in)\s+(\d+)\s*seconds?/i)?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
};

export default function AuthPage() {
  const { user, loading, requiresCustomerMfa, refreshSecurity } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const recoveryRequested = params.get("recovery") === "1";
  const resetSucceeded = params.get("reset") === "success";
  const [mode, setMode] = useState(recoveryRequested ? "recovery" : params.get("mode") === "signup" ? "signup" : "signin");
  const [stage, setStage] = useState("details");
  const [form, setForm] = useState(initialForm);
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPhone, setPendingPhone] = useState("");
  const [verifiedUserId, setVerifiedUserId] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [message, setMessage] = useState(resetSucceeded ? "Password updated. Sign in with your new password and SMS code." : "");
  const [messageType, setMessageType] = useState(resetSucceeded ? "success" : "");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recoverySmsVerified, setRecoverySmsVerified] = useState(null);
  const rawDestination = params.get("return") || "/account";
  const destination = rawDestination.startsWith("/") && !rawDestination.startsWith("//") ? rawDestination : "/account";
  const signupDestination = params.has("return") ? destination : "/";
  const signupEmailRedirect = `${window.location.origin}/login?mode=signup&return=${encodeURIComponent(signupDestination)}`;
  const signupPhonePath = `/verify-phone?purpose=signup&return=${encodeURIComponent(signupDestination)}`;

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (resetSucceeded && mode === "signin") return;
    setMessage(""); setMessageType(""); setStage("details");
    setEmailCode(""); setSmsCode(""); setResendSeconds(0); setVerifiedUserId("");
  }, [mode, resetSucceeded]);

  useEffect(() => {
    if (!resendSeconds) return undefined;
    const timer = window.setInterval(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (mode !== "recovery" || !user || loading || !requiresCustomerMfa) return;
    let active = true;
    setRecoverySmsVerified(null);
    getCustomerSmsStatus("recovery")
      .then((status) => { if (active) setRecoverySmsVerified(Boolean(status.verified)); })
      .catch(() => { if (active) setRecoverySmsVerified(false); });
    return () => { active = false; };
  }, [mode, user, loading, requiresCustomerMfa]);

  const completingSignup = mode === "signup" && stage !== "details";
  if (user && mode === "recovery" && !loading && requiresCustomerMfa && recoverySmsVerified === null)
    return <div className="page-loader">Checking password-reset security…</div>;
  if (user && mode === "recovery" && !loading && requiresCustomerMfa && !recoverySmsVerified)
    return <Navigate to={`/verify-phone?purpose=recovery&return=${encodeURIComponent("/login?recovery=1")}`} replace />;
  if (user && mode === "signup" && !loading && stage === "details") return <Navigate to={signupPhonePath} replace />;
  if (user && mode !== "recovery" && !completingSignup) return <Navigate to={destination} replace />;

  const validateSignup = () => {
    const email = form.email.trim().toLowerCase();
    if (!form.firstName.trim() || !form.lastName.trim()) return "Enter your first and last name.";
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
    if (email !== form.confirmEmail.trim().toLowerCase()) return "The email addresses do not match.";
    if (!toUsE164(form.phone)) return "Enter a valid 10-digit U.S. mobile number.";
    if (form.password.length < 12) return "Use at least 12 characters for your password.";
    if (form.password !== form.confirmPassword) return "The passwords do not match.";
    if (!form.agree) return "Agree to the Terms and Privacy Policy to create an account.";
    return "";
  };

  const submitCredentials = async (event) => {
    event.preventDefault(); setMessage(""); setMessageType("");
    if (mode === "signin") {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
      setBusy(false);
      if (error) setMessage(friendlyError(error));
      return;
    }
    const validationMessage = validateSignup();
    if (validationMessage) return setMessage(validationMessage);
    const email = form.email.trim().toLowerCase();
    const phone = toUsE164(form.phone);
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: {
        data: { first_name: form.firstName.trim(), last_name: form.lastName.trim(), phone },
        emailRedirectTo: signupEmailRedirect,
      },
    });
    setBusy(false);
    if (error) {
      if (isEmailSendRateLimit(error)) {
        setPendingEmail(email); setPendingPhone(phone); setEmailCode(""); setVerifiedUserId("");
        setStage("email-code"); setResendSeconds(emailRetrySeconds(error)); setMessageType("");
        return setMessage("This email already has a pending signup. Enter the most recent code, or send a fresh code when the timer reaches zero.");
      }
      return setMessage(friendlyError(error));
    }
    if (data.session) {
      await supabase.auth.signOut();
      return setMessage("Email-code confirmation must be enabled before new accounts can be created.");
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      return setMessage("We could not start a new signup for this email. If you already verified it, sign in or use Forgot password.");
    setPendingEmail(email); setPendingPhone(phone); setEmailCode(""); setVerifiedUserId("");
    setStage("email-code"); setResendSeconds(30); setMessageType("success");
    setMessage(`We sent a fresh six-digit verification code to ${email}.`);
  };

  const verifyEmail = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage(""); setMessageType("");
    let userId = verifiedUserId;
    if (!userId) {
      if (!/^\d{6}$/.test(emailCode)) {
        setBusy(false);
        return setMessage("Enter the complete six-digit email code.");
      }
      const { data, error } = await supabase.auth.verifyOtp({ email: pendingEmail, token: emailCode, type: "signup" });
      if (error || !data.session) {
        setBusy(false);
        return setMessage(friendlyError(error));
      }
      userId = data.session.user.id;
      setVerifiedUserId(userId);
    }

    const latestDetails = {
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      phone: pendingPhone,
    };
    const { error: accountError } = await supabase.auth.updateUser({ password: form.password, data: latestDetails });
    const { error: profileError } = accountError
      ? { error: null }
      : await supabase.from("profiles").update(latestDetails).eq("id", userId);
    setBusy(false);
    if (accountError || profileError) {
      setMessage("Your email is verified, but we could not save the latest account details. Select Save details & continue to retry.");
      return;
    }
    setVerifiedUserId(""); setStage("sms-ready"); setResendSeconds(0); setMessageType("success");
    setMessage("Email verified. Now verify your mobile number.");
  };

  const resendEmail = async () => {
    setBusy(true); setMessage(""); setMessageType("");
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail, options: { emailRedirectTo: signupEmailRedirect } });
    setBusy(false);
    if (error) {
      if (isEmailSendRateLimit(error)) setResendSeconds(emailRetrySeconds(error));
      return setMessage(friendlyError(error));
    }
    setResendSeconds(30); setMessageType("success");
    setMessage(`A new email code was sent to ${pendingEmail}.`);
  };

  const sendSms = async () => {
    setBusy(true); setMessage(""); setMessageType("");
    try {
      const result = await sendCustomerSmsCode({ phone: pendingPhone, purpose: "signup" });
      setChallengeId(result.challenge_id); setSmsCode(""); setStage("sms-code");
      setResendSeconds(result.resend_after || 30); setMessageType("success");
      setMessage(`We sent a six-digit SMS code to ${result.phone || formatUsPhone(pendingPhone)}.`);
    } catch (error) {
      if (error.retryAfter) setResendSeconds(error.retryAfter);
      setMessage(friendlyError(error));
    } finally { setBusy(false); }
  };

  const verifySms = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(smsCode)) return setMessage("Enter the complete six-digit SMS code.");
    setBusy(true); setMessage(""); setMessageType("");
    try {
      await verifyCustomerSmsCode({ challengeId, code: smsCode });
      await refreshSecurity();
      navigate(signupDestination, { replace: true });
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
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
    try {
      await updatePasswordAfterSms(form.password);
      await supabase.auth.signOut();
      window.location.assign("/login?reset=success");
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (nextMode) => {
    setMode(nextMode); setForm(initialForm); setPendingEmail(""); setPendingPhone("");
    setChallengeId(""); setVerifiedUserId("");
  };
  const signupStep = stage === "details" ? 1 : stage === "email-code" ? 2 : 3;

  return <section className="auth-section"><div className="container auth-grid">
    <div className="auth-promise"><span className="eyebrow">SECURE CUSTOMER ACCOUNT</span><h1>Your bullion account, protected.</h1><p>See order totals, payment progress, fulfillment updates, saved delivery details, and private support requests in one place.</p><ul><li><ShieldCheck /> Your orders are visible only to you</li><li><LockKeyhole /> Password plus email and SMS verification</li><li><CheckCircle2 /> No full payment-card numbers stored here</li></ul></div>
    <div className="auth-card">
      {!['forgot', 'recovery'].includes(mode) && stage === "details" && <div className="auth-tabs"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => switchMode("signin")}>Sign in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Create account</button></div>}
      {mode === "forgot" ? <><div className="auth-card-heading"><Mail /><h2>Reset your password</h2><p>We will email a one-time secure link.</p></div><form onSubmit={sendReset}><label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{message && <div className={`form-message ${messageType}`}>{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button><button type="button" className="text-button centered" onClick={() => setMode("signin")}>Back to sign in</button></form></>
      : mode === "recovery" ? <><div className="auth-card-heading"><LockKeyhole /><h2>Choose a new password</h2><p>Use a unique password with at least 12 characters.</p></div><form onSubmit={updatePassword}><PasswordField label="New password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} /><PasswordField label="Confirm new password" value={form.confirmPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, confirmPassword: value })} />{message && <div className="form-message error">{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Updating securely…" : "Update password"}</button></form></>
      : mode === "signup" && stage === "email-code" ? <><button className="auth-back" type="button" onClick={() => { setStage("details"); setMessage(""); setVerifiedUserId(""); }}><ArrowLeft /> Use a different email</button><Progress step={signupStep} /><div className="auth-card-heading"><Mail /><h2>{verifiedUserId ? "Finish your account" : "Verify your email"}</h2><p>{verifiedUserId ? "Your email is verified. Save your latest signup details to continue." : <>Enter the six-digit code sent to <b>{pendingEmail}</b>.</>}</p></div><form onSubmit={verifyEmail}>{!verifiedUserId && <CodeField label="Six-digit email code" value={emailCode} onChange={setEmailCode} />}{message && <div className={`form-message ${messageType || "error"}`}>{message}</div>}<button className="button button-gold full" disabled={busy || (!verifiedUserId && emailCode.length !== 6)}>{busy ? verifiedUserId ? "Saving…" : "Verifying…" : verifiedUserId ? "Save details & continue" : "Verify email"}</button>{!verifiedUserId && <button type="button" className="text-button centered" disabled={busy || resendSeconds > 0} onClick={resendEmail}>{resendSeconds > 0 ? `Send another email code in ${resendSeconds}s` : "Send another email code"}</button>}</form></>
      : mode === "signup" && stage === "sms-ready" ? <><Progress step={signupStep} /><div className="auth-card-heading"><Smartphone /><h2>Verify your mobile number</h2><p>Email verified. We’ll text a security code to <b>{formatUsPhone(pendingPhone)}</b>.</p></div>{message && <div className={`form-message ${messageType || "error"}`}>{message}</div>}<button className="button button-gold full" type="button" disabled={busy} onClick={sendSms}><MessageSquareText /> {busy ? "Sending securely…" : "Send Code"}</button><SmsConsentDisclosure /></>
      : mode === "signup" && stage === "sms-code" ? <><Progress step={signupStep} /><div className="auth-card-heading"><MessageSquareText /><h2>Enter your SMS code</h2><p>Enter the six-digit code sent to <b>{formatUsPhone(pendingPhone)}</b>. Your account opens only after this step.</p></div><form onSubmit={verifySms}><CodeField label="Six-digit SMS code" value={smsCode} onChange={setSmsCode} />{message && <div className={`form-message ${messageType || "error"}`}>{message}</div>}<button className="button button-gold full" disabled={busy || smsCode.length !== 6}>{busy ? "Verifying…" : "Verify & finish account"}</button><button type="button" className="text-button centered" disabled={busy || resendSeconds > 0} onClick={sendSms}>{resendSeconds > 0 ? `Send another SMS code in ${resendSeconds}s` : "Send another SMS code"}</button></form></>
      : <><div className="auth-card-heading">{mode === "signup" ? <ShieldCheck /> : <LockKeyhole />}<h2>{mode === "signup" ? "Create your account" : "Sign in"}</h2><p>{mode === "signup" ? "Create your password, then verify both your email and mobile number." : "Use your email and password. We’ll ask for an SMS code next."}</p></div>{mode === "signup" && <Progress step={signupStep} />}<form onSubmit={submitCredentials}>{mode === "signup" && <div className="form-row"><label>First name<input required maxLength="60" autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label><label>Last name<input required maxLength="60" autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label></div>}<label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{mode === "signup" && <><label>Re-enter email address<input required type="email" autoComplete="email" value={form.confirmEmail} onChange={(event) => setForm({ ...form, confirmEmail: event.target.value })} /></label><label>Mobile number<span className="phone-input"><span aria-hidden="true">+1</span><input required type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(212) 555-0123" maxLength="14" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatUsPhone(event.target.value) })} /></span><small className="field-help">Used only for account verification and security SMS.</small></label></>}<PasswordField label="Password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 8} />{mode === "signup" && <><PasswordField label="Re-enter password" value={form.confirmPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, confirmPassword: value })} autoComplete="new-password" minLength={12} /><SmsConsentDisclosure /><label className="auth-agreement"><input type="checkbox" checked={form.agree} onChange={(event) => setForm({ ...form, agree: event.target.checked })} /> <span>I agree to the <Link to="/terms">Terms &amp; Conditions</Link> and <Link to="/privacy">Privacy Policy</Link>.</span></label></>}{message && <div className={`form-message ${messageType || "error"}`}>{message}</div>}<button className="button button-gold full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Continue to verification" : "Sign in securely"}</button>{mode === "signin" && <button type="button" className="text-button centered" onClick={() => setMode("forgot")}>Forgot password?</button>}</form></>}
    </div>
  </div></section>;
}

function Progress({ step }) {
  return <div className="auth-progress" aria-label={`Step ${step} of 3`}>
    {["Details", "Email", "SMS"].map((label, index) => {
      const number = index + 1;
      return <span className="auth-progress-part" key={label}>{index > 0 && <i />}<span className={step > number ? "done" : step === number ? "active" : ""}>{step > number ? <CheckCircle2 /> : <b>{number}</b>} {label}</span></span>;
    })}
  </div>;
}

function CodeField({ label, value, onChange }) {
  return <label>{label}<span className="auth-otp-input"><input required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))} /></span></label>;
}

function PasswordField({ label, value, onChange, show, onShow, autoComplete = "new-password", minLength = 12 }) {
  return <label>{label}<span className="password-input"><input required type={show ? "text" : "password"} minLength={minLength} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /><button type="button" onClick={onShow} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff /> : <Eye />}</button></span><small className="field-help">{minLength >= 12 ? "At least 12 characters; use a password you do not use elsewhere." : "Enter your account password."}</small></label>;
}
