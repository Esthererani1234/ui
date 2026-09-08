import { authSessionId, authenticateCustomer, service } from "./payments.js";

const SETTING_KEYS = [
  "sms_provider_name",
  "sms_sender",
  "sms_provider_ready",
  "customer_sms_mfa_required",
  "sms_code_ttl_seconds",
  "sms_resend_seconds",
  "sms_max_attempts",
  "sms_session_hours",
];

const numberSetting = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
};

export const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  const usDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{10}$/.test(usDigits) ? `+1${usDigits}` : "";
};

export const maskPhone = (phone) => {
  const normalized = normalizePhone(phone);
  return normalized ? `(***) ***-${normalized.slice(-4)}` : "";
};

export async function readSmsSettings() {
  const { data, error } = await service().from("app_settings").select("key,value").in("key", SETTING_KEYS);
  if (error) throw error;
  const values = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return {
    provider: String(values.sms_provider_name || "messagebird").toLowerCase(),
    sender: String(values.sms_sender || "").trim(),
    providerReady: Boolean(values.sms_provider_ready),
    required: Boolean(values.customer_sms_mfa_required),
    codeTtlSeconds: numberSetting(values.sms_code_ttl_seconds, 300, 60, 600),
    resendSeconds: numberSetting(values.sms_resend_seconds, 30, 30, 180),
    maxAttempts: numberSetting(values.sms_max_attempts, 5, 3, 10),
    sessionHours: numberSetting(values.sms_session_hours, 720, 1, 2160),
  };
}

export async function readSmsSecret() {
  const { data, error } = await service().rpc("get_sms_provider_secret");
  if (error) throw error;
  const secret = typeof data === "string" ? JSON.parse(data) : data;
  if (secret?.provider !== "messagebird" || !secret?.access_key) return null;
  return secret;
}

export async function authenticateSmsRequest(request) {
  const { user, token } = await authenticateCustomer(request);
  return { user, token, sessionId: authSessionId(token) };
}

export const messageBirdError = async (response) => {
  let body = null;
  try { body = await response.json(); } catch { /* provider returned no JSON */ }
  const providerMessage = body?.errors?.[0]?.description || body?.description || "";
  if (response.status === 429) return Object.assign(new Error("Too many code requests. Wait and try again."), { status: 429 });
  if (response.status === 401 || response.status === 403)
    return Object.assign(new Error("MessageBird needs to be reconnected by an administrator."), { status: 503, providerMessage });
  if (response.status === 422)
    return Object.assign(new Error("That security code is incorrect or expired."), { status: 422, providerMessage });
  if (/token|attempt|expired|verify/i.test(providerMessage))
    return Object.assign(new Error("That security code is incorrect or expired."), { status: 422, providerMessage });
  return Object.assign(new Error("The security text could not be completed. Try again shortly."), { status: 502, providerMessage });
};

export async function callMessageBird(path, options, accessKey) {
  const response = await fetch(`https://rest.messagebird.com${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: `AccessKey ${accessKey}`,
      ...(options?.headers || {}),
    },
  });
  if (!response.ok) throw await messageBirdError(response);
  return response.status === 204 ? null : response.json();
}

export async function customerPhone(userId) {
  const { data, error } = await service().from("profiles").select("phone,phone_verified_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  return {
    phone: normalizePhone(data?.phone),
    verified: Boolean(data?.phone && data?.phone_verified_at),
  };
}
