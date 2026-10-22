import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.6";

import { checkSession, rateLimit, hashSubject, readObject, safeLog } from "../_shared/security.ts";

const allowedOrigins = new Set([
  "https://goldonthespot.com",
  "https://www.goldonthespot.com",
  "https://ui-esther-eranis-projects.vercel.app",
  "https://ui-git-main-esther-eranis-projects.vercel.app",
  "http://localhost:5173",
]);
const vercelOrigin = /^https:\/\/ui-[a-z0-9-]+-esther-eranis-projects\.vercel\.app$/;
const originAllowed = (origin: string) => allowedOrigins.has(origin) || vercelOrigin.test(origin);
const cors = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    ...(originAllowed(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
};
const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(request), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const defaultKey = (modern: string, legacy: string) => {
  const value = Deno.env.get(modern);
  if (value) return JSON.parse(value).default as string;
  return Deno.env.get(legacy) || "";
};
const jwtClaims = (token: string) => {
  try {
    const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))) as Record<string, unknown>;
  } catch { return {}; }
};
const clean = (value: unknown, maximum = 200) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const messageBirdKeyKind = (value: unknown) => {
  const key = String(value || "");
  if (/^live_[A-Za-z0-9_-]{20,}$/.test(key)) return "legacy";
  if (/^bk_(us1|eu1)_[A-Za-z0-9_-]{10,}$/.test(key)) return "platform";
  return "";
};
const isMessageBirdKey = (value: unknown) => Boolean(messageBirdKeyKind(value));
const integer = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
};
const normalizePhone = (value: unknown) => {
  const digits = String(value || "").replace(/\D/g, "");
  const usDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{10}$/.test(usDigits) ? `+1${usDigits}` : "";
};
const maskPhone = (phone: unknown) => {
  const normalized = normalizePhone(phone);
  return normalized ? `(***) ***-${normalized.slice(-4)}` : "";
};
const phoneAlreadyRegistered = "This mobile number is already linked to an account. Sign in with that account or use a different mobile number. If you need help, contact GoldOnTheSpot support.";
const settingKeys = [
  "sms_provider_name", "sms_sender", "sms_provider_ready", "customer_sms_mfa_required",
  "sms_code_ttl_seconds", "sms_resend_seconds", "sms_max_attempts", "sms_session_hours",
  "sms_provider_tested_at",
];

type AdminClient = SupabaseClient;
const readSettings = async (admin: AdminClient) => {
  const { data, error } = await admin.from("app_settings").select("key,value").in("key", settingKeys);
  if (error) throw error;
  const values = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return {
    provider: String(values.sms_provider_name || "messagebird").toLowerCase(),
    sender: String(values.sms_sender || "").trim(),
    providerReady: Boolean(values.sms_provider_ready),
    required: values.customer_sms_mfa_required !== false,
    codeTtlSeconds: integer(values.sms_code_ttl_seconds, 60, 600, 300),
    resendSeconds: integer(values.sms_resend_seconds, 30, 180, 30),
    maxAttempts: integer(values.sms_max_attempts, 3, 10, 5),
    sessionHours: integer(values.sms_session_hours, 1, 2160, 720),
    providerTestedAt: clean(values.sms_provider_tested_at, 40),
  };
};
const readSecret = async (admin: AdminClient) => {
  const { data, error } = await admin.rpc("get_sms_provider_secret");
  if (error) throw error;
  const secret = typeof data === "string" ? JSON.parse(data) : data;
  return secret?.provider === "messagebird" && secret?.access_key ? secret as { provider: string; access_key: string } : null;
};
const providerError = async (response: Response, operation: "send" | "check") => {
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* provider returned no JSON */ }
  const errors = Array.isArray(body.errors) ? body.errors as Array<Record<string, unknown>> : [];
  const nestedError = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
  const detail = clean(
    errors[0]?.description || errors[0]?.message || nestedError.message || body.detail || body.description || body.message || body.title,
    300,
  );
  const reason = clean(errors[0]?.code || nestedError.code || body.reason || body.code, 100);
  const providerDetail = [reason, detail].filter(Boolean).join(": ");
  if (response.status === 429) return Object.assign(new Error("Too many code requests. Wait and try again."), { status: 429, detail });
  if (response.status === 401 || response.status === 403) return Object.assign(new Error("Bird rejected the saved API key or its Verify permission. Create a Bird key with Verify access and reconnect it in Admin Security."), { status: 503, detail: providerDetail });
  if (operation === "check" && (response.status === 404 || response.status === 422 || /token|attempt|expired|verify/i.test(providerDetail)))
    return Object.assign(new Error("That security code is incorrect or expired."), { status: 422, detail: providerDetail });
  if (operation === "send" && response.status === 422) {
    if (/noavailablechannel|no available channel|no usable channel|country|destination/i.test(providerDetail))
      return Object.assign(new Error("Bird has no SMS route enabled for this phone number. Enable United States SMS in Bird Verify country settings, then test again."), { status: 503, detail: providerDetail });
    if (/balance|credit|fund|payment/i.test(providerDetail))
      return Object.assign(new Error("Bird could not send because the SMS balance or billing setup is not ready. Add SMS credit in Bird, then test again."), { status: 503, detail: providerDetail });
    if (/scope|permission|access/i.test(providerDetail))
      return Object.assign(new Error("The Bird API key does not have permission to use Verify. Create a key with Verify access, then reconnect it."), { status: 503, detail: providerDetail });
    if (/sender|originator|brand/i.test(providerDetail))
      return Object.assign(new Error("Bird rejected the SMS sender configuration. Finish the sender setup in Bird Verify, then test again."), { status: 503, detail: providerDetail });
    return Object.assign(new Error(`Bird rejected the SMS request${providerDetail ? `: ${providerDetail}` : ". Check Bird Verify country and billing settings."}`), { status: 503, detail: providerDetail });
  }
  return Object.assign(new Error(`The security text could not be completed${providerDetail ? `: ${providerDetail}` : ". Try again shortly."}`), { status: 502, detail: providerDetail });
};
const messageBird = async (path: string, options: RequestInit, accessKey: string, operation: "send" | "check") => {
  const platform = messageBirdKeyKind(accessKey) === "platform";
  const region = accessKey.startsWith("bk_eu1_") ? "eu1" : "us1";
  const base = platform ? `https://${region}.platform.bird.com` : "https://rest.messagebird.com";
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: platform ? `Bearer ${accessKey}` : `AccessKey ${accessKey}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw await providerError(response, operation);
  return response.status === 204 ? null : response.json();
};
const startVerification = async (
  accessKey: string,
  phone: string,
  settings: { sender: string; codeTtlSeconds: number; maxAttempts: number },
) => {
  const modernProvider = messageBirdKeyKind(accessKey) === "platform";
  const verification = modernProvider
    ? await messageBird("/v1/verify/verifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: { phone_number: phone },
        options: { code_length: 6, channels: ["sms"] },
        metadata: { reference: `gots${Date.now()}` },
      }),
    }, accessKey, "send") as Record<string, unknown>
    : await messageBird("/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        recipient: phone.replace(/^\+/, ""), originator: settings.sender, type: "sms",
        template: "Your Gold On The Spot security code is %token. It expires soon. Do not share this code. Reply STOP to opt out; HELP for help.",
        timeout: String(settings.codeTtlSeconds), tokenLength: "6", maxAttempts: String(settings.maxAttempts), reference: `gots${Date.now()}`,
      }).toString(),
    }, accessKey, "send") as Record<string, unknown>;
  if (!verification?.id) throw Object.assign(new Error("Bird accepted the request but did not start a verification."), { status: 502 });
  return { verification, modernProvider };
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return originAllowed(request.headers.get("origin") || "")
    ? new Response("ok", { headers: cors(request) })
    : new Response("Forbidden", { status: 403 });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (!originAllowed(request.headers.get("origin") || "")) return json(request, { error: "Origin not allowed" }, 403);
  if (Number(request.headers.get("content-length") || 0) > 10_000) return json(request, { error: "Request is too large" }, 413);

  try {
    const auth = request.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return json(request, { error: "Sign in required" }, 401);
    const token = auth.slice(7);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const pub = defaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = defaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !pub || !secretKey) throw new Error("SMS service is not configured");
    const userClient = createClient(url, pub, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json(request, { error: "Your session expired. Please sign in again." }, 401);
    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await readObject(request, 10_000) as Record<string, unknown>;
    const action = clean(body.action, 40);
    const allowedFields: Record<string,string[]> = {
      status:["action","purpose"], send:["action","purpose","phone"], verify:["action","challenge_id","code"],
      password_update:["action","password"], admin_get:["action"],
      admin_update:["action","access_key","sender","required","reason","code_ttl_seconds","resend_seconds","max_attempts","session_hours","test_phone"],
    };
    if (!allowedFields[action] || Object.keys(body).some(key=>!allowedFields[action].includes(key))) return json(request,{error:"Invalid request fields."},400);
    const sessionId = String(jwtClaims(token).session_id || "");
    if (!sessionId) return json(request, { error: "Your session expired. Please sign in again." }, 401);

    await checkSession(admin, user.id, sessionId);

    if (action === "admin_get" || action === "admin_update") {
      const claims = jwtClaims(token);
      if (claims.aal !== "aal2") return json(request, { error: "Admin two-factor verification required" }, 403);
      const { data: membership } = await admin.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!membership) return json(request, { error: "Administrator access required" }, 403);
      const current = await readSettings(admin);
      const currentSecret = await readSecret(admin).catch(() => null);
      if (action === "admin_get") return json(request, {
        ...current,
        configured: isMessageBirdKey(currentSecret?.access_key),
        provider_ready: current.providerReady && Boolean(current.providerTestedAt),
        provider_tested_at: current.providerTestedAt,
        invalid_key_type: Boolean(currentSecret?.access_key) && !isMessageBirdKey(currentSecret?.access_key),
        access_key_last4: currentSecret?.access_key?.slice(-4) || "",
      });

      const accessKey = clean(body.access_key, 500) || currentSecret?.access_key || "";
      const sender = clean(body.sender, 30);
      const required = Boolean(body.required);
      const reason = clean(body.reason, 1000);
      const codeTtlSeconds = integer(body.code_ttl_seconds, 60, 600, current.codeTtlSeconds);
      const resendSeconds = integer(body.resend_seconds, 30, 180, current.resendSeconds);
      const maxAttempts = integer(body.max_attempts, 3, 10, current.maxAttempts);
      const sessionHours = integer(body.session_hours, 1, 2160, current.sessionHours);
      const testPhone = normalizePhone(body.test_phone);
      if (!accessKey) return json(request, { error: "Enter the MessageBird access key." }, 400);
      if (!isMessageBirdKey(accessKey)) return json(request, { error: "Use a current Bird API key (bk_us1_… or bk_eu1_…) or a legacy MessageBird live REST key (live_…)." }, 400);
      if (!/^\+?[0-9]{7,15}$/.test(sender.replace(/[ ()-]/g, ""))) return json(request, { error: "Enter the verified MessageBird sender number with country code." }, 400);
      if (!testPhone) return json(request, { error: "Enter a valid 10-digit U.S. mobile number for the live SMS test." }, 400);
      if (reason.length < 3) return json(request, { error: "Enter a reason for this security change." }, 400);
      // The only authoritative connection test is a real Verify request. It
      // validates the key, Verify permission, country route, and SMS billing.
      await rateLimit(admin, "sms_admin_test", user.id, 3, 3600);
      const testSettings = { sender, codeTtlSeconds, maxAttempts };
      const { verification: testVerification } = await startVerification(accessKey, testPhone, testSettings);
      const testedAt = new Date().toISOString();
      const { error: secretError } = await admin.rpc("set_sms_provider_secret", { secret_value: { provider: "messagebird", access_key: accessKey } });
      if (secretError) throw secretError;
      const rows = [
        { key: "sms_provider_name", value: "messagebird", is_public: true },
        { key: "sms_sender", value: sender, is_public: true },
        { key: "sms_provider_ready", value: true, is_public: true },
        { key: "customer_sms_mfa_required", value: required, is_public: true },
        { key: "sms_code_ttl_seconds", value: codeTtlSeconds, is_public: true },
        { key: "sms_resend_seconds", value: resendSeconds, is_public: true },
        { key: "sms_max_attempts", value: maxAttempts, is_public: true },
        { key: "sms_session_hours", value: sessionHours, is_public: false },
        { key: "sms_provider_tested_at", value: testedAt, is_public: false },
      ];
      const { error: settingsError } = await admin.from("app_settings").upsert(rows);
      if (settingsError) throw settingsError;
      await admin.from("admin_audit_log").insert({
        actor_user_id: user.id, action: "security.customer_sms_updated", target_type: "security", target_id: "messagebird", reason,
        metadata: { required, sender, code_ttl_seconds: codeTtlSeconds, resend_seconds: resendSeconds, max_attempts: maxAttempts, session_hours: sessionHours, access_key_last4: accessKey.slice(-4), test_phone_last4: testPhone.slice(-4), provider_tested_at: testedAt },
      });
      return json(request, {
        success: true,
        configured: true,
        provider_ready: true,
        provider_tested_at: testedAt,
        access_key_last4: accessKey.slice(-4),
        test_phone: maskPhone(testPhone),
        test_channel: clean(testVerification.last_channel, 20) || "sms",
      });
    }

    const [{ data: profile, error: profileError }, settings] = await Promise.all([
      admin.from("profiles").select("phone,phone_verified_at").eq("id", user.id).maybeSingle(),
      readSettings(admin),
    ]);
    if (profileError) throw profileError;
    const savedPhone = normalizePhone(profile?.phone);
    const phoneVerified = Boolean(savedPhone && profile?.phone_verified_at);

    if (action === "status") {
      const [providerSecret, sessionResult] = await Promise.all([
        readSecret(admin).catch(() => null),
        admin.from("customer_sms_sessions").select("verified_at,expires_at,purpose,phone").eq("user_id", user.id).eq("session_id", sessionId).gt("expires_at", new Date().toISOString()).maybeSingle(),
      ]);
      if (sessionResult.error) throw sessionResult.error;
      const configured = settings.provider === "messagebird" && settings.providerReady && isMessageBirdKey(providerSecret?.access_key) && Boolean(settings.sender);
      const required = settings.required;
      const purpose = clean(body.purpose, 20) === "recovery" ? "recovery" : "signin";
      return json(request, {
        configured, required,
        verified: !required || Boolean(phoneVerified && sessionResult.data?.phone === savedPhone && (purpose !== "recovery" || sessionResult.data.purpose === "recovery")),
        phone_enrolled: phoneVerified, phone: maskPhone(savedPhone),
        resend_seconds: settings.resendSeconds, code_ttl_seconds: settings.codeTtlSeconds,
      });
    }

    if (action === "send") {
      const purpose = ["signup", "signin", "recovery", "enrollment"].includes(clean(body.purpose, 20)) ? clean(body.purpose, 20) : "signin";
      const providerSecret = await readSecret(admin);
      if (settings.provider !== "messagebird" || !settings.providerReady || !settings.required || !providerSecret?.access_key || !settings.sender)
        return json(request, { error: "SMS security is not configured yet." }, 503);
      if (purpose === "recovery" && !phoneVerified)
        return json(request, { error: "No verified mobile number is enrolled. Contact GoldOnTheSpot support for account recovery." }, 403);
      const requestedPhone = normalizePhone(body.phone);
      const phone = phoneVerified ? savedPhone : requestedPhone || savedPhone;
      if (!phone) return json(request, { error: "Enter a valid 10-digit U.S. mobile number." }, 400);
      const now = new Date();
      // Reserve limits BEFORE calling the paid provider, including failed sends.
      await rateLimit(admin, "sms_cooldown", user.id, 1, settings.resendSeconds);
      await rateLimit(admin, "sms_hour", user.id, 5, 3600);
      await rateLimit(admin, "sms_day", user.id, 20, 86400);
      const { data: phoneAvailable, error: phoneCheckError } = await admin.rpc("can_enroll_customer_phone", {
        p_user_id: user.id, p_phone: phone,
      });
      if (phoneCheckError) throw phoneCheckError;
      if (phoneAvailable !== true) return json(request, { error: phoneAlreadyRegistered, code: "phone_already_registered" }, 409);
      const phoneHash = await hashSubject(phone);
      await rateLimit(admin, "sms_phone_hour", phoneHash, 5, 3600);
      await rateLimit(admin, "sms_phone_day", phoneHash, 20, 86400);
      const { verification, modernProvider } = await startVerification(providerSecret.access_key, phone, settings);
      if (!settings.providerTestedAt) {
        const testedAt = new Date().toISOString();
        await admin.from("app_settings").upsert([
          { key: "sms_provider_ready", value: true, is_public: true },
          { key: "sms_provider_tested_at", value: testedAt, is_public: false },
        ]);
      }
      const expiresAt = verification.expires_at
        ? new Date(String(verification.expires_at))
        : verification.validUntilDatetime
          ? new Date(String(verification.validUntilDatetime))
          : new Date(now.getTime() + settings.codeTtlSeconds * 1000);
      const { data: challenge, error: insertError } = await admin.from("customer_sms_challenges").insert({
        user_id: user.id, session_id: sessionId, provider_verify_id: verification.id, phone, purpose, expires_at: new Date(Math.min(Number.isFinite(expiresAt.getTime()) ? expiresAt.getTime() : now.getTime(), now.getTime() + settings.codeTtlSeconds * 1000)).toISOString(),
      }).select("id").single();
      if (insertError) {
        if (!modernProvider) await messageBird(`/verify/${encodeURIComponent(String(verification.id))}`, { method: "DELETE" }, providerSecret.access_key, "send").catch(() => {});
        throw insertError;
      }
      return json(request, { challenge_id: challenge.id, phone: maskPhone(phone), expires_in: settings.codeTtlSeconds, resend_after: settings.resendSeconds });
    }

    if (action === "verify") {
      const challengeId = typeof body.challenge_id === "string" ? body.challenge_id.trim() : "";
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId) || !/^\d{6}$/.test(code)) return json(request, { error: "Enter the complete six-digit security code." }, 400);
      const { data: challenge, error: challengeError } = await admin.rpc("claim_sms_attempt", {
        p_challenge_id: challengeId, p_user_id: user.id, p_session_id: sessionId, p_max_attempts: settings.maxAttempts,
      });
      if (challengeError) throw challengeError;
      if (!challenge) return json(request, { error: "That code is expired or has too many attempts. Send a new code." }, 410);
      const providerSecret = await readSecret(admin);
      if (!providerSecret?.access_key) return json(request, { error: "MessageBird needs to be reconnected by an administrator." }, 503);
      try {
        const verification = messageBirdKeyKind(providerSecret.access_key) === "platform"
          ? await messageBird("/v1/verify/verifications/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: { phone_number: challenge.phone }, code }) }, providerSecret.access_key, "check") as Record<string, unknown>
          : await messageBird(`/verify/${encodeURIComponent(challenge.provider_verify_id)}?token=${encodeURIComponent(code)}`, { method: "GET" }, providerSecret.access_key, "check") as Record<string, unknown>;
        if (messageBirdKeyKind(providerSecret.access_key) === "platform" ? verification?.success !== true : verification?.status !== "verified") throw Object.assign(new Error("That security code is incorrect or expired."), { status: 422 });
      } catch (error) {
        if ((error as { status?: number }).status === 422 && challenge.attempt_count >= settings.maxAttempts)
          await admin.from("customer_sms_challenges").update({ status: "failed" }).eq("id", challenge.id).eq("status", "pending");
        throw error;
      }
      const { data: completed, error: completeError } = await admin.rpc("complete_sms_challenge", {
        p_challenge_id: challenge.id, p_user_id: user.id, p_session_id: sessionId, p_session_hours: settings.sessionHours,
      });
      if (completeError?.code === "P2001")
        return json(request, { error: phoneAlreadyRegistered, code: "phone_already_registered" }, 409);
      if (completeError) throw completeError;
      if (!completed) return json(request, { error: "That code is no longer active. Send a new code." }, 410);
      return json(request, { verified: true });
    }

    if (action === "password_update") {
      await checkSession(admin, user.id, sessionId, true);
      await rateLimit(admin, "password_update", user.id, 5, 3600);
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 12 || password.length > 200) return json(request, { error: "Use a password from 12 to 200 characters." }, 400);
      const { data: smsSession, error: sessionError } = await admin.from("customer_sms_sessions").select("session_id").eq("user_id", user.id).eq("session_id", sessionId).eq("purpose", "recovery").gt("expires_at", new Date().toISOString()).maybeSingle();
      if (sessionError) throw sessionError;
      if (!smsSession) return json(request, { error: "Verify the SMS security code before changing the password." }, 403);
      const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });
      if (updateError) throw updateError;
      await admin.from("customer_sms_sessions").delete().eq("session_id", sessionId).eq("user_id", user.id);
      return json(request, { success: true });
    }
    return json(request, { error: "Invalid action" }, 400);
  } catch (error) {
    const safe = error as { status?: number; message?: string; retry_after?: number };
    safeLog("customer_sms_failed", error);
    return json(request, { error: safe.status && safe.status < 500 ? safe.message : "SMS security is temporarily unavailable. Please try again shortly.", ...(safe.retry_after ? { retry_after: safe.retry_after } : {}) }, safe.status || 500);
  }
});
