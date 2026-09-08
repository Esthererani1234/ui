import { authenticateSmsRequest, callMessageBird, customerPhone, maskPhone, normalizePhone, readSmsSecret, readSmsSettings } from "../../_lib/customer-sms.js";
import { json, readJson, service } from "../../_lib/payments.js";

export const config = { api: { bodyParser: false } };
const PURPOSES = new Set(["signup", "signin", "recovery", "enrollment"]);

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user, sessionId } = await authenticateSmsRequest(request);
    const body = await readJson(request, 5_000);
    const purpose = PURPOSES.has(body.purpose) ? body.purpose : "signin";
    const [settings, secret, profilePhone] = await Promise.all([readSmsSettings(), readSmsSecret(), customerPhone(user.id)]);
    if (settings.provider !== "messagebird" || !settings.providerReady || !settings.required || !secret?.access_key || !settings.sender)
      throw Object.assign(new Error("SMS security is not configured yet."), { status: 503 });

    if (purpose === "recovery" && !profilePhone.verified)
      throw Object.assign(new Error("No verified mobile number is enrolled. Contact GoldOnTheSpot support for account recovery."), { status: 403 });

    const requestedPhone = normalizePhone(body.phone);
    const phone = profilePhone.verified ? profilePhone.phone : requestedPhone || profilePhone.phone;
    if (!phone) throw Object.assign(new Error("Enter a valid 10-digit U.S. mobile number."), { status: 400 });

    const db = service();
    const now = new Date();
    const sinceHour = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const sinceDay = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const [latestResult, hourResult, dayResult] = await Promise.all([
      db.from("customer_sms_challenges").select("created_at").eq("user_id", user.id).eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("customer_sms_challenges").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", sinceHour),
      db.from("customer_sms_challenges").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", sinceDay),
    ]);
    if (latestResult.error || hourResult.error || dayResult.error) throw latestResult.error || hourResult.error || dayResult.error;
    if (latestResult.data) {
      const retryAfter = settings.resendSeconds - Math.floor((now.getTime() - new Date(latestResult.data.created_at).getTime()) / 1000);
      if (retryAfter > 0)
        return json(response, 429, { error: `Send another code in ${retryAfter} seconds.`, retry_after: retryAfter });
    }
    if ((hourResult.count || 0) >= 5 || (dayResult.count || 0) >= 20)
      throw Object.assign(new Error("Too many security-code requests. Try again later or contact support."), { status: 429 });

    const form = new URLSearchParams({
      recipient: phone.replace(/^\+/, ""),
      originator: settings.sender,
      type: "sms",
      template: "Your Gold On The Spot security code is %token. It expires soon. Do not share this code. Reply STOP to opt out; HELP for help.",
      timeout: String(settings.codeTtlSeconds),
      tokenLength: "6",
      maxAttempts: String(settings.maxAttempts),
      reference: `gots${Date.now()}`,
    });
    const verification = await callMessageBird("/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
    }, secret.access_key);
    if (!verification?.id) throw Object.assign(new Error("MessageBird did not start the verification."), { status: 502 });

    const expiresAt = verification.validUntilDatetime
      ? new Date(verification.validUntilDatetime)
      : new Date(now.getTime() + settings.codeTtlSeconds * 1000);
    const { data: challenge, error: insertError } = await db.from("customer_sms_challenges").insert({
      user_id: user.id,
      session_id: sessionId,
      provider_verify_id: verification.id,
      phone,
      purpose,
      expires_at: expiresAt.toISOString(),
    }).select("id").single();
    if (insertError) {
      await callMessageBird(`/verify/${encodeURIComponent(verification.id)}`, { method: "DELETE" }, secret.access_key).catch(() => {});
      throw insertError;
    }
    return json(response, 200, {
      challenge_id: challenge.id,
      phone: maskPhone(phone),
      expires_in: settings.codeTtlSeconds,
      resend_after: settings.resendSeconds,
    });
  } catch (error) {
    console.error("customer SMS send failed", error.providerMessage || error.message || error);
    return json(response, error.status || 500, { error: error.status ? error.message : "The security text could not be sent." });
  }
}
