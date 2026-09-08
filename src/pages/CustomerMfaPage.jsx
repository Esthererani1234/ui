import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { LockKeyhole, LogOut, MessageSquareText, ShieldCheck } from "lucide-react";
import { formatUsPhone, toUsE164 } from "../lib/phone";
import { getCustomerSmsStatus, sendCustomerSmsCode, verifyCustomerSmsCode } from "../lib/customerSms";
import { useAuth } from "../state/AuthContext";
import SmsConsentDisclosure from "../components/SmsConsentDisclosure";

const friendlySmsError = (error) => {
  if (/incorrect|expired|no longer active/i.test(error?.message || ""))
    return "That security code is incorrect or expired. Send a new code and try again.";
  if (/too many|another code/i.test(error?.message || "")) return error.message;
  return error?.message || "SMS verification could not be completed.";
};

export default function CustomerMfaPage() {
  const { user, profile, customerSmsVerified, requiresCustomerMfa, refreshSecurity, signOut } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const destination = useMemo(() => {
    const requested = params.get("return") || "/account";
    return requested.startsWith("/") && !requested.startsWith("//") ? requested : "/account";
  }, [params]);
  const requestedPurpose = params.get("purpose");
  const purpose = ["signup", "signin", "recovery", "enrollment"].includes(requestedPurpose) ? requestedPurpose : "signin";
  const recovery = purpose === "recovery" || destination.startsWith("/login?recovery=1");
  const [phone, setPhone] = useState(formatUsPhone(profile?.phone || ""));
  const [maskedPhone, setMaskedPhone] = useState("");
  const [phoneEnrolled, setPhoneEnrolled] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (!recovery && customerSmsVerified) {
      navigate(destination, { replace: true });
      return;
    }
    let active = true;
    getCustomerSmsStatus(recovery ? "recovery" : purpose)
      .then((status) => {
        if (!active) return;
        setMaskedPhone(status.phone || "");
        setPhoneEnrolled(Boolean(status.phone_enrolled));
        if (status.verified) navigate(destination, { replace: true });
        else if (recovery && !status.phone_enrolled) {
          setStage("blocked");
          setMessage("No verified mobile number is enrolled. Contact GoldOnTheSpot support for account recovery.");
        } else setStage(status.phone_enrolled ? "send" : "setup");
      })
      .catch((error) => {
        if (!active) return;
        setStage("blocked");
        setMessage(friendlySmsError(error));
      });
    return () => { active = false; };
  }, [user, customerSmsVerified, destination, navigate, recovery, purpose]);

  useEffect(() => {
    if (!resendSeconds) return undefined;
    const timer = window.setInterval(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  if (!requiresCustomerMfa) return <Navigate to={destination} replace />;

  const sendCode = async () => {
    setBusy(true);
    setMessage("");
    try {
      const normalizedPhone = phoneEnrolled ? "" : toUsE164(phone);
      if (!phoneEnrolled && !normalizedPhone) throw new Error("Enter a valid 10-digit U.S. mobile number.");
      const result = await sendCustomerSmsCode({ phone: normalizedPhone, purpose: recovery ? "recovery" : purpose });
      setChallengeId(result.challenge_id);
      setMaskedPhone(result.phone || maskedPhone);
      setCode("");
      setStage("verify");
      setResendSeconds(result.resend_after || 30);
      setMessage("A six-digit GoldOnTheSpot security code was sent by text.");
    } catch (error) {
      if (error.retryAfter) setResendSeconds(error.retryAfter);
      setMessage(friendlySmsError(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return setMessage("Enter the six-digit code from the text message.");
    setBusy(true);
    setMessage("");
    try {
      await verifyCustomerSmsCode({ challengeId, code });
      await refreshSecurity();
      navigate(destination, { replace: true });
    } catch (error) {
      setMessage(friendlySmsError(error));
    } finally {
      setBusy(false);
    }
  };

  return <section className="customer-mfa-shell"><div className="customer-mfa-card">
    <div className="customer-mfa-icon"><ShieldCheck /></div>
    <span className="eyebrow dark">CUSTOMER IDENTITY PROTECTION</span>
    <h1>Verify it’s really you</h1>
    <p>GoldOnTheSpot requires a one-time SMS code before account and checkout access. We will never ask you to read this code to anyone.</p>
    {stage === "loading" ? <div className="catalog-loading">Checking account security…</div>
    : stage === "blocked" ? null
    : stage === "setup" ? <div className="customer-mfa-form">
      <label>Mobile number<span className="phone-input"><span aria-hidden="true">+1</span><input type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(212) 555-0123" maxLength="14" value={phone} onChange={(event) => setPhone(formatUsPhone(event.target.value))} /></span><small>U.S. mobile number. Standard carrier messaging rates may apply.</small></label>
      <button className="button button-gold full" onClick={sendCode} disabled={busy}><MessageSquareText /> {busy ? "Sending securely…" : "Send Code"}</button>
      <SmsConsentDisclosure />
    </div>
    : stage === "send" ? <div className="customer-mfa-form">
      <div className="verified-destination"><MessageSquareText /><span><small>Verification destination</small><b>{maskedPhone || "Your verified phone"}</b></span></div>
      <button className="button button-gold full" onClick={sendCode} disabled={busy}>{busy ? "Sending securely…" : "Send Code"}</button>
      <SmsConsentDisclosure />
    </div>
    : <form className="customer-mfa-form" onSubmit={verify}>
      <label>Six-digit SMS code<span className="mfa-code-input"><LockKeyhole /><input required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></span></label>
      <button className="button button-gold full" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and continue"}</button>
      <button type="button" className="text-button centered" onClick={sendCode} disabled={busy || resendSeconds > 0}>{resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : "Send another code"}</button>
    </form>}
    {message && <div className="form-message">{message}</div>}
    <button className="customer-mfa-signout" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut /> Sign out and use another account</button>
  </div></section>;
}
