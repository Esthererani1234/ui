import { callMessageBird, readSmsSecret, readSmsSettings } from "../_lib/customer-sms.js";
import { json, readJson, requireAdmin, service } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };
const clean = (value, maximum = 200) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const integer = (value, minimum, maximum, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
};

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return json(response, 405, { error: "Method not allowed" });
  try {
    const actor = await requireAdmin(request);
    const current = await readSmsSettings();
    const currentSecret = await readSmsSecret().catch(() => null);
    if (request.method === "GET") {
      return json(response, 200, { ...current, configured: Boolean(currentSecret?.access_key), access_key_last4: currentSecret?.access_key?.slice(-4) || "" });
    }

    const body = await readJson(request, 10_000);
    const accessKey = clean(body.access_key, 500) || currentSecret?.access_key || "";
    const sender = clean(body.sender, 30);
    const required = Boolean(body.required);
    const reason = clean(body.reason, 1000);
    const codeTtlSeconds = integer(body.code_ttl_seconds, 60, 600, current.codeTtlSeconds);
    const resendSeconds = integer(body.resend_seconds, 30, 180, current.resendSeconds);
    const maxAttempts = integer(body.max_attempts, 3, 10, current.maxAttempts);
    const sessionHours = integer(body.session_hours, 1, 2160, current.sessionHours);
    if (!accessKey) throw Object.assign(new Error("Enter the MessageBird access key."), { status: 400 });
    if (!/^\+?[0-9]{7,15}$/.test(sender.replace(/[ ()-]/g, "")))
      throw Object.assign(new Error("Enter the verified MessageBird sender number with country code."), { status: 400 });
    if (reason.length < 3) throw Object.assign(new Error("Enter a reason for this security change."), { status: 400 });

    await callMessageBird("/balance", { method: "GET" }, accessKey);
    const { error: secretError } = await service().rpc("set_sms_provider_secret", { secret_value: { provider: "messagebird", access_key: accessKey } });
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
    const { error: settingsError } = await service().from("app_settings").upsert(rows);
    if (settingsError) throw settingsError;
    await service().from("admin_audit_log").insert({
      actor_user_id: actor.id,
      action: "security.customer_sms_updated",
      target_type: "security",
      target_id: "messagebird",
      reason,
      metadata: { required, sender, code_ttl_seconds: codeTtlSeconds, resend_seconds: resendSeconds, max_attempts: maxAttempts, session_hours: sessionHours, access_key_last4: accessKey.slice(-4) },
    });
    return json(response, 200, { success: true, configured: true, access_key_last4: accessKey.slice(-4) });
  } catch (error) {
    console.error("SMS settings failed", error.providerMessage || error.message || error);
    return json(response, error.status || 500, { error: error.status ? error.message : "SMS settings could not be saved." });
  }
}
