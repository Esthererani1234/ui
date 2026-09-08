import { supabase } from "./supabase";

const request = async (path, options = {}) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");
  const response = await fetch(`/api/auth/sms/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "SMS verification is temporarily unavailable.");
    error.status = response.status;
    error.retryAfter = Number(result.retry_after || 0);
    throw error;
  }
  return result;
};

export const getCustomerSmsStatus = (purpose = "signin") => request(`status?purpose=${encodeURIComponent(purpose)}`);
export const sendCustomerSmsCode = ({ phone, purpose }) => request("send", {
  method: "POST",
  body: JSON.stringify({ phone, purpose }),
});
export const verifyCustomerSmsCode = ({ challengeId, code }) => request("verify", {
  method: "POST",
  body: JSON.stringify({ challenge_id: challengeId, code }),
});

export const updatePasswordAfterSms = (password) => {
  const run = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your reset session expired. Request a new password-reset email.");
    const response = await fetch("/api/auth/password/update", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The password could not be updated.");
    return result;
  };
  return run();
};
