// Re-running completion must be safe after an OTP has already been consumed.
export async function saveVerifiedSignup(client, { userId, password, details }) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (data?.user?.id !== userId || !data.user.email_confirmed_at)
    throw new Error("Your session expired. Sign in again to finish verification.");

  const passwordResult = await client.auth.updateUser({ password });
  // A new signup already has this password. A resumed signup may not.
  // Only this exact error is safe to treat as an already-completed write.
  if (passwordResult.error && passwordResult.error.code !== "same_password")
    throw passwordResult.error;
  const metadataResult = await client.auth.updateUser({ data: details });
  if (metadataResult.error) throw metadataResult.error;
  const profileResult = await client.from("profiles").update(details)
    .eq("id", userId).select("id").single();
  if (profileResult.error) throw profileResult.error;
  if (profileResult.data?.id !== userId)
    throw new Error("Your profile could not be saved. Please retry.");
}

export const isEmailSendRateLimit = (error) =>
  error?.code === "over_email_send_rate_limit";

export function authDestination(requested, fallback = "/account") {
  // Backslashes and control characters can turn a local-looking URL external.
  return typeof requested === "string" && requested.startsWith("/") &&
    !requested.startsWith("//") && !/[\\\u0000-\u0020]/.test(requested)
    ? requested : fallback;
}
