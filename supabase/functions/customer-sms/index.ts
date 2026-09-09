import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

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
const settingKeys = [
  "sms_provider_name", "sms_sender", "sms_provider_ready", "customer_sms_mfa_required",
  "sms_code_ttl_seconds", "sms_resend_seconds", "sms_max_attempts", "sms_session_hours",
];

type AdminClient = ReturnType<typeof createClient>;
const readSettings = async (admin: AdminClient) => {
  const { data, error } = await admin.from("app_settings").select("key,value").in("key", settingKeys);
  if (error) throw error;
  const values = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return {
    provider: String(values.sms_provider_name || "messagebird").toLowerCase(),
    sender: String(values.sms_sender || "").trim(),
    providerReady: Boolean(values.sms_provider_ready),
    required: Boolean(values.customer_sms_mfa_required),
    codeTtlSeconds: integer(values.sms_code_ttl_seconds, 60, 600, 300),
    resendSeconds: integer(values.sms_resend_seconds, 30, 180, 30),
    maxAttempts: integer(values.sms_max_attempts, 3, 10, 5),
    sessionHours: integer(values.sms_session_hours, 1, 2160, 720),
  };
};
const readSecret = async (admin: AdminClient) => {
  const { data, error } = await admin.rpc("get_sms_provider_secret");
  if (error) throw error;
  const secret = typeof data === "string" ? JSON.parse(data) : data;
  return secret?.provider === "messagebird" && secret?.access_key ? secret as { provider: string; access_key: string } : null;
};
const providerError = async (response: Response) => {
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* provider returned no JSON */ }
  const errors = Array.isArray(body.errors) ? body.errors as Array<Record<string, unknown>> : [];
  const detail = String(errors[0]?.description || body.description || "");
  if (response.status === 429) return Object.assign(new Error("Too many code requests. Wait and try again."), { status: 429, detail });
  if (response.status === 401 || response.status === 403) return Object.assign(new Error("Bird rejected the saved access key. Reconnect it in Admin Security."), { status: 503, detail });
  if (response.status === 422 || /token|attempt|expired|verify/i.test(detail)) return Object.assign(new Error("That security code is incorrect or expired."), { status: 422, detail });
  return Object.assign(new Error("The security text could not be completed. Try again shortly."), { status: 502, detail });
};
const messageBird = async (path: string, options: RequestInit, accessKey: string) => {
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
  if (!response.ok) throw await providerError(response);
  return response.status === 204 ? null : response.json();
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
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    const sessionId = String(jwtClaims(token).session_id || "");
    if (!sessionId) return json(request, { error: "Your session expired. Please sign in again." }, 401);

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
      if (!accessKey) return json(request, { error: "Enter the MessageBird access key." }, 400);
      if (!isMessageBirdKey(accessKey)) return json(request, { error: "Use a current Bird API key (bk_us1_… or bk_eu1_…) or a legacy MessageBird live REST key (live_…)." }, 400);
      if (!/^\+?[0-9]{7,15}$/.test(sender.replace(/[ ()-]/g, ""))) return json(request, { error: "Enter the verified MessageBird sender number with country code." }, 400);
      if (reason.length < 3) return json(request, { error: "Enter a reason for this security change." }, 400);
      // Do not validate against /balance: restricted SMS/Verify keys may be
      // allowed to send codes while correctly lacking account-balance access.
      // The first Verify request remains the authoritative provider check.
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
      ];
      const { error: settingsError } = await admin.from("app_settings").upsert(rows);
      if (settingsError) throw settingsError;
      await admin.from("admin_audit_log").insert({
        actor_user_id: user.id, action: "security.customer_sms_updated", target_type: "security", target_id: "messagebird", reason,
        metadata: { required, sender, code_ttl_seconds: codeTtlSeconds, resend_seconds: resendSeconds, max_attempts: maxAttempts, session_hours: sessionHours, access_key_last4: accessKey.slice(-4) },
      });
      return json(request, { success: true, configured: true, access_key_last4: accessKey.slice(-4) });
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
        admin.from("customer_sms_sessions").select("verified_at,expires_at,purpose").eq("user_id", user.id).eq("session_id", sessionId).gt("expires_at", new Date().toISOString()).maybeSingle(),
      ]);
      if (sessionResult.error) throw sessionResult.error;
      const configured = settings.provider === "messagebird" && settings.providerReady && isMessageBirdKey(providerSecret?.access_key) && Boolean(settings.sender);
      const required = configured && settings.required;
      const purpose = clean(body.purpose, 20) === "recovery" ? "recovery" : "signin";
      return json(request, {
        configured, required,
        verified: !required || Boolean(sessionResult.data && (purpose !== "recovery" || sessionResult.data.purpose === "recovery")),
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
      const [latestResult, hourResult, dayResult] = await Promise.all([
        admin.from("customer_sms_challenges").select("created_at").eq("user_id", user.id).eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("customer_sms_challenges").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(now.getTime() - 3_600_000).toISOString()),
        admin.from("customer_sms_challenges").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(now.getTime() - 86_400_000).toISOString()),
      ]);
      if (latestResult.error || hourResult.error || dayResult.error) throw latestResult.error || hourResult.error || dayResult.error;
      if (latestResult.data) {
        const retryAfter = settings.resendSeconds - Math.floor((now.getTime() - new Date(latestResult.data.created_at).getTime()) / 1000);
        if (retryAfter > 0) return json(request, { error: `Send another code in ${retryAfter} seconds.`, retry_after: retryAfter }, 429);
      }
      if ((hourResult.count || 0) >= 5 || (dayResult.count || 0) >= 20) return json(request, { error: "Too many security-code requests. Try again later or contact support." }, 429);
      const modernProvider = messageBirdKeyKind(providerSecret.access_key) === "platform";
      const verification = modernProvider
        ? await messageBird("/v1/verify/verifications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: { phone_number: phone },
            options: { code_length: 6, channels: ["sms"] },
            metadata: { reference: `gots${Date.now()}` },
          }),
        }, providerSecret.access_key) as Record<string, unknown>
        : await messageBird("/verify", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({
            recipient: phone.replace(/^\+/, ""), originator: settings.sender, type: "sms",
            template: "Your Gold On The Spot security code is %token. It expires soon. Do not share this code. Reply STOP to opt out; HELP for help.",
            timeout: String(settings.codeTtlSeconds), tokenLength: "6", maxAttempts: String(settings.maxAttempts), reference: `gots${Date.now()}`,
          }).toString(),
        }, providerSecret.access_key) as Record<string, unknown>;
      if (!verification?.id) throw Object.assign(new Error("MessageBird did not start the verification."), { status: 502 });
      const expiresAt = verification.expires_at
        ? new Date(String(verification.expires_at))
        : verification.validUntilDatetime
          ? new Date(String(verification.validUntilDatetime))
          : new Date(now.getTime() + settings.codeTtlSeconds * 1000);
      const { data: challenge, error: insertError } = await admin.from("customer_sms_challenges").insert({
        user_id: user.id, session_id: sessionId, provider_verify_id: verification.id, phone, purpose, expires_at: expiresAt.toISOString(),
      }).select("id").single();
      if (insertError) {
        if (!modernProvider) await messageBird(`/verify/${encodeURIComponent(String(verification.id))}`, { method: "DELETE" }, providerSecret.access_key).catch(() => {});
        throw insertError;
      }
      return json(request, { challenge_id: challenge.id, phone: maskPhone(phone), expires_in: settings.codeTtlSeconds, resend_after: settings.resendSeconds });
    }

    if (action === "verify") {
      const challengeId = clean(body.challenge_id, 36);
      const code = clean(body.code, 6);
      if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) return json(request, { error: "Enter the complete six-digit security code." }, 400);
      const { data: challenge, error: challengeError } = await admin.from("customer_sms_challenges").select("*").eq("id", challengeId).eq("user_id", user.id).eq("session_id", sessionId).eq("status", "pending").maybeSingle();
      if (challengeError) throw challengeError;
      if (!challenge) return json(request, { error: "That security code request is no longer active. Send a new code." }, 410);
      if (new Date(challenge.expires_at) <= new Date()) {
        await admin.from("customer_sms_challenges").update({ status: "expired" }).eq("id", challenge.id);
        return json(request, { error: "That security code expired. Send a new code." }, 410);
      }
      const providerSecret = await readSecret(admin);
      if (!providerSecret?.access_key) return json(request, { error: "MessageBird needs to be reconnected by an administrator." }, 503);
      await admin.from("customer_sms_challenges").update({ attempt_count: challenge.attempt_count + 1 }).eq("id", challenge.id);
      try {
        const verification = messageBirdKeyKind(providerSecret.access_key) === "platform"
          ? await messageBird("/v1/verify/verifications/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: { phone_number: challenge.phone }, code }) }, providerSecret.access_key) as Record<string, unknown>
          : await messageBird(`/verify/${encodeURIComponent(challenge.provider_verify_id)}?token=${encodeURIComponent(code)}`, { method: "GET" }, providerSecret.access_key) as Record<string, unknown>;
        if (messageBirdKeyKind(providerSecret.access_key) === "platform" ? verification?.success !== true : verification?.status !== "verified") throw Object.assign(new Error("That security code is incorrect or expired."), { status: 422 });
      } catch (error) {
        if ((error as { status?: number }).status === 422 && challenge.attempt_count + 1 >= settings.maxAttempts)
          await admin.from("customer_sms_challenges").update({ status: "failed" }).eq("id", challenge.id);
        throw error;
      }
      const verifiedAt = new Date();
      const expiresAt = new Date(verifiedAt.getTime() + settings.sessionHours * 3_600_000);
      const [sessionResult, profileResult, challengeResult] = await Promise.all([
        admin.from("customer_sms_sessions").upsert({ session_id: sessionId, user_id: user.id, phone: challenge.phone, purpose: challenge.purpose, verified_at: verifiedAt.toISOString(), expires_at: expiresAt.toISOString() }, { onConflict: "session_id" }),
        admin.from("profiles").update({ phone: challenge.phone, phone_verified_at: verifiedAt.toISOString() }).eq("id", user.id),
        admin.from("customer_sms_challenges").update({ status: "verified", verified_at: verifiedAt.toISOString() }).eq("id", challenge.id),
      ]);
      if (sessionResult.error || profileResult.error || challengeResult.error) throw sessionResult.error || profileResult.error || challengeResult.error;
      return json(request, { verified: true });
    }

    if (action === "password_update") {
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
    const safe = error as { status?: number; message?: string; detail?: string };
    console.error("customer SMS failed", safe.detail || safe.message || safe);
    return json(request, { error: safe.status ? safe.message : "SMS security is temporarily unavailable." }, safe.status || 500);
  }
});
