import { authenticateSmsRequest, callMessageBird, readSmsSecret, readSmsSettings } from "../../_lib/customer-sms.js";
import { json, readJson, service } from "../../_lib/payments.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  let challenge = null;
  try {
    const { user, sessionId } = await authenticateSmsRequest(request);
    const body = await readJson(request, 5_000);
    if (!/^[0-9a-f-]{36}$/i.test(String(body.challenge_id || "")) || !/^\d{6}$/.test(String(body.code || "")))
      throw Object.assign(new Error("Enter the complete six-digit security code."), { status: 400 });
    const db = service();
    const challengeResult = await db.from("customer_sms_challenges").select("*")
      .eq("id", body.challenge_id).eq("user_id", user.id).eq("session_id", sessionId).eq("status", "pending").maybeSingle();
    if (challengeResult.error) throw challengeResult.error;
    challenge = challengeResult.data;
    if (!challenge) throw Object.assign(new Error("That security code request is no longer active. Send a new code."), { status: 410 });
    if (new Date(challenge.expires_at) <= new Date()) {
      await db.from("customer_sms_challenges").update({ status: "expired" }).eq("id", challenge.id);
      throw Object.assign(new Error("That security code expired. Send a new code."), { status: 410 });
    }

    const [settings, secret] = await Promise.all([readSmsSettings(), readSmsSecret()]);
    if (!secret?.access_key) throw Object.assign(new Error("MessageBird needs to be reconnected by an administrator."), { status: 503 });
    await db.from("customer_sms_challenges").update({ attempt_count: challenge.attempt_count + 1 }).eq("id", challenge.id);
    const verification = await callMessageBird(`/verify/${encodeURIComponent(challenge.provider_verify_id)}?token=${encodeURIComponent(body.code)}`, { method: "GET" }, secret.access_key);
    if (verification?.status !== "verified")
      throw Object.assign(new Error("That security code is incorrect or expired."), { status: 422 });

    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + settings.sessionHours * 60 * 60 * 1000);
    const [sessionResult, profileResult, challengeUpdate] = await Promise.all([
      db.from("customer_sms_sessions").upsert({ session_id: sessionId, user_id: user.id, phone: challenge.phone, purpose: challenge.purpose, verified_at: verifiedAt.toISOString(), expires_at: expiresAt.toISOString() }, { onConflict: "session_id" }),
      db.from("profiles").update({ phone: challenge.phone, phone_verified_at: verifiedAt.toISOString() }).eq("id", user.id),
      db.from("customer_sms_challenges").update({ status: "verified", verified_at: verifiedAt.toISOString() }).eq("id", challenge.id),
    ]);
    if (sessionResult.error || profileResult.error || challengeUpdate.error)
      throw sessionResult.error || profileResult.error || challengeUpdate.error;
    return json(response, 200, { verified: true });
  } catch (error) {
    console.error("customer SMS verify failed", error.providerMessage || error.message || error);
    if (challenge && error.status === 422) {
      const settings = await readSmsSettings().catch(() => ({ maxAttempts: 5 }));
      if (challenge.attempt_count + 1 >= settings.maxAttempts)
        await service().from("customer_sms_challenges").update({ status: "failed" }).eq("id", challenge.id).catch(() => {});
    }
    return json(response, error.status || 500, { error: error.status ? error.message : "The security code could not be verified." });
  }
}
