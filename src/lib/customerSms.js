import { supabase } from "./supabase";

const request = async (body) => {
  const { data, error } = await supabase.functions.invoke("customer-sms", { body });
  if (error || data?.error) {
    const errorBody = error?.context?.json
      ? await error.context.clone().json().catch(() => ({}))
      : {};
    const requestError = new Error(data?.error || errorBody?.error || error?.message || "SMS verification is temporarily unavailable.");
    requestError.status = error?.context?.status || 500;
    requestError.retryAfter = Number(data?.retry_after || errorBody?.retry_after || 0);
    throw requestError;
  }
  return data;
};

export const getCustomerSmsStatus = (purpose = "signin") => request({ action: "status", purpose });
export const sendCustomerSmsCode = ({ phone, purpose }) => request({ action: "send", phone, purpose });
export const verifyCustomerSmsCode = ({ challengeId, code }) => request({ action: "verify", challenge_id: challengeId, code });

export const updatePasswordAfterSms = (password) => request({ action: "password_update", password });
