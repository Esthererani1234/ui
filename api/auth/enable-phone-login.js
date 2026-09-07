import { authenticateCustomer, json, service } from "../_lib/payments.js";

const toE164 = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
};

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user, token } = await authenticateCustomer(request);
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (claims.aal !== "aal2") return json(response, 403, { error: "Complete SMS verification first" });

    const db = service();
    const [{ data: securityRows, error: securityError }, { data: profile, error: profileError }] = await Promise.all([
      db.rpc("admin_customer_security_summary"),
      db.from("profiles").select("phone").eq("id", user.id).maybeSingle(),
    ]);
    if (securityError || profileError) throw securityError || profileError;
    const security = (securityRows || []).find((row) => row.user_id === user.id);
    if (!security?.has_phone_mfa) return json(response, 403, { error: "A verified SMS factor is required" });

    const phone = toE164(profile?.phone);
    if (!phone) return json(response, 400, { error: "A valid verified mobile number is required" });
    const { error } = await db.auth.admin.updateUserById(user.id, { phone, phone_confirm: true });
    if (error) {
      if (/already|registered|exists/i.test(error.message || "")) return json(response, 409, { error: "That mobile number already belongs to another account" });
      throw error;
    }
    return json(response, 200, { ok: true });
  } catch (error) {
    return json(response, error.status || 500, { error: error.status ? error.message : "Unable to enable SMS sign-in" });
  }
}
