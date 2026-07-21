import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { LockKeyhole, LogOut, MessageSquareText, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatUsPhone, toUsE164 } from "../lib/phone";
import { useAuth } from "../state/AuthContext";

const friendlyMfaError = (error) => {
  const message = error?.message || "SMS verification could not be completed.";
  if (/unsupported|disabled|phone provider|sms provider/i.test(message))
    return "SMS security is not active yet. Contact GoldOnTheSpot support.";
  if (/expired|invalid.*code|challenge/i.test(message))
    return "That security code is invalid or expired. Send a new code and try again.";
  if (/rate|too many/i.test(message))
    return "Too many code requests. Wait a minute and try again.";
  return message;
};

export default function CustomerMfaPage() {
  const { user, profile, aal, phoneMfaVerified, requiresCustomerMfa, refreshSecurity, signOut } =
    useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const destination = useMemo(() => {
    const requested = params.get("return") || "/account";
    return requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/account";
  }, [params]);
  const [phone, setPhone] = useState(formatUsPhone(profile?.phone || ""));
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (aal === "aal2" && phoneMfaVerified) {
      navigate(destination, { replace: true });
      return;
    }
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) {
        setMessage(friendlyMfaError(error));
        setStage("setup");
        return;
      }
      const existing = data?.phone?.find(
        (factor) => factor.status === "verified",
      );
      if (existing) {
        setFactorId(existing.id);
        setPhone(formatUsPhone(existing.phone || profile?.phone || ""));
        setStage("send");
      } else {
        setStage("setup");
      }
    });
  }, [user, aal, phoneMfaVerified, destination, navigate, profile?.phone]);

  useEffect(() => {
    if (!resendSeconds) return undefined;
    const timer = window.setInterval(
      () => setResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  if (!requiresCustomerMfa) return <Navigate to={destination} replace />;

  const sendCode = async () => {
    setBusy(true);
    setMessage("");
    let nextFactorId = factorId;
    try {
      if (!nextFactorId) {
        const normalizedPhone = toUsE164(phone);
        if (!normalizedPhone)
          throw new Error("Enter a valid 10-digit U.S. mobile number.");
        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: "phone",
          friendlyName: "GoldOnTheSpot SMS",
          phone: normalizedPhone,
        });
        if (error) throw error;
        nextFactorId = data.id;
        setFactorId(data.id);
        setPhone(formatUsPhone(normalizedPhone));
      }
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: nextFactorId });
      if (challengeError) throw challengeError;
      setChallengeId(challenge.id);
      setCode("");
      setStage("verify");
      setResendSeconds(30);
      setMessage("A six-digit GoldOnTheSpot security code was sent by text.");
    } catch (error) {
      setMessage(friendlyMfaError(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the six-digit code from the text message.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (error) {
      setMessage(friendlyMfaError(error));
      setBusy(false);
      return;
    }
    await supabase
      .from("profiles")
      .update({ phone: toUsE164(phone) || phone })
      .eq("id", user.id);
    await refreshSecurity();
    setBusy(false);
    navigate(destination, { replace: true });
  };

  return (
    <section className="customer-mfa-shell">
      <div className="customer-mfa-card">
        <div className="customer-mfa-icon"><ShieldCheck /></div>
        <span className="eyebrow dark">CUSTOMER IDENTITY PROTECTION</span>
        <h1>Verify it’s really you</h1>
        <p>
          GoldOnTheSpot requires a one-time SMS code before account and checkout
          access. We will never ask you to read this code to anyone.
        </p>
        {stage === "loading" ? (
          <div className="catalog-loading">Checking account security…</div>
        ) : stage === "setup" ? (
          <div className="customer-mfa-form">
            <label>
              Mobile number
              <span className="phone-input">
                <span aria-hidden="true">+1</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="(212) 555-0123"
                  maxLength="14"
                  value={phone}
                  onChange={(event) => setPhone(formatUsPhone(event.target.value))}
                />
              </span>
              <small>U.S. mobile number. Standard carrier messaging rates may apply.</small>
            </label>
            <button className="button button-gold full" onClick={sendCode} disabled={busy}>
              <MessageSquareText /> {busy ? "Sending securely…" : "Send security code"}
            </button>
          </div>
        ) : stage === "send" ? (
          <div className="customer-mfa-form">
            <div className="verified-destination">
              <MessageSquareText />
              <span><small>Verification destination</small><b>{phone || "Your enrolled phone"}</b></span>
            </div>
            <button className="button button-gold full" onClick={sendCode} disabled={busy}>
              {busy ? "Sending securely…" : "Text me a security code"}
            </button>
          </div>
        ) : (
          <form className="customer-mfa-form" onSubmit={verify}>
            <label>
              Six-digit SMS code
              <span className="mfa-code-input"><LockKeyhole /><input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength="6"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              /></span>
            </label>
            <button className="button button-gold full" disabled={busy}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
            <button
              type="button"
              className="text-button centered"
              onClick={sendCode}
              disabled={busy || resendSeconds > 0}
            >
              {resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : "Send another code"}
            </button>
          </form>
        )}
        {message && <div className="form-message">{message}</div>}
        <button className="customer-mfa-signout" onClick={async () => { await signOut(); navigate("/login"); }}>
          <LogOut /> Sign out and use another account
        </button>
      </div>
    </section>
  );
}
