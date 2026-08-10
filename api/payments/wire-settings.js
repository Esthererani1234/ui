import { json, readJson, requireAdmin, saveWireSettings, service, wireSettings } from "../_lib/payments.js";

export const config = { api: { bodyParser: false } };

const clean = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return json(response, 405, { error: "Method not allowed" });
  try {
    const actor = await requireAdmin(request);
    if (request.method === "GET") {
      const settings = await wireSettings().catch(() => null);
      return json(response, 200, { configured: Boolean(settings), settings: settings ? { ...settings, account_number: settings.account_number ? `••••${settings.account_number.slice(-4)}` : "" } : null });
    }
    const body = await readJson(request);
    const settings = {
      bank_name: clean(body.bank_name), beneficiary_name: clean(body.beneficiary_name),
      routing_number: clean(body.routing_number, 30), account_number: clean(body.account_number, 50),
      swift_code: clean(body.swift_code, 30), bank_address: clean(body.bank_address, 300), notes: clean(body.notes, 500),
    };
    if (!settings.bank_name || !settings.beneficiary_name || !settings.routing_number || !settings.account_number) return json(response, 400, { error: "Bank, beneficiary, routing number, and account number are required" });
    await saveWireSettings(settings);
    await service().from("admin_audit_log").insert({ actor_user_id: actor.id, action: "payments.wire_settings_updated", target_type: "payment_settings", target_id: "wire_instructions", reason: clean(body.reason, 1000) || "Updated encrypted wire instructions", metadata: { bank_name: settings.bank_name, account_last4: settings.account_number.slice(-4) } });
    return json(response, 200, { success: true, account_last4: settings.account_number.slice(-4) });
  } catch (error) {
    console.error("wire settings failed", error);
    return json(response, error.status || 500, { error: error.status ? error.message : "Wire settings could not be saved" });
  }
}
