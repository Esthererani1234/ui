import { authenticateSmsRequest } from "../../_lib/customer-sms.js";
import { json, readJson, service } from "../../_lib/payments.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  try {
    const { user, sessionId } = await authenticateSmsRequest(request);
    const body = await readJson(request, 5_000);
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 12 || password.length > 200)
      throw Object.assign(new Error("Use a password from 12 to 200 characters."), { status: 400 });
    const db = service();
    const { data: smsSession, error: sessionError } = await db.from("customer_sms_sessions")
      .select("session_id").eq("user_id", user.id).eq("session_id", sessionId).eq("purpose", "recovery")
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (sessionError) throw sessionError;
    if (!smsSession)
      throw Object.assign(new Error("Verify the SMS security code before changing the password."), { status: 403 });
    const { error: updateError } = await db.auth.admin.updateUserById(user.id, { password });
    if (updateError) throw updateError;
    await db.from("customer_sms_sessions").delete().eq("session_id", sessionId).eq("user_id", user.id);
    return json(response, 200, { success: true });
  } catch (error) {
    console.error("secure password update failed", error.message || error);
    return json(response, error.status || 500, { error: error.status ? error.message : "The password could not be updated." });
  }
}

