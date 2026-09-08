import { authenticateSmsRequest, customerPhone, maskPhone, readSmsSecret, readSmsSettings } from "../../_lib/customer-sms.js";
import { json, service } from "../../_lib/payments.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user, sessionId } = await authenticateSmsRequest(request);
    const recovery = new URL(request.url, "https://goldonthespot.com").searchParams.get("purpose") === "recovery";
    const [settings, secret, phoneResult, sessionResult] = await Promise.all([
      readSmsSettings(),
      readSmsSecret().catch(() => null),
      customerPhone(user.id),
      service().from("customer_sms_sessions").select("verified_at,expires_at,purpose").eq("user_id", user.id).eq("session_id", sessionId).gt("expires_at", new Date().toISOString()).maybeSingle(),
    ]);
    if (sessionResult.error) throw sessionResult.error;
    const configured = settings.provider === "messagebird" && settings.providerReady && Boolean(secret?.access_key) && Boolean(settings.sender);
    const required = configured && settings.required;
    return json(response, 200, {
      configured,
      required,
      verified: !required || Boolean(sessionResult.data && (!recovery || sessionResult.data.purpose === "recovery")),
      phone_enrolled: phoneResult.verified,
      phone: maskPhone(phoneResult.phone),
      resend_seconds: settings.resendSeconds,
      code_ttl_seconds: settings.codeTtlSeconds,
    });
  } catch (error) {
    return json(response, error.status || 500, { error: error.status ? error.message : "SMS security status is unavailable" });
  }
}
