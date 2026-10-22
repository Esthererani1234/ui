import { rateLimit, strictObject, securityLog } from "../lib/security.js";
import { json, readJson, requireAdmin, service, wireSettings } from "../lib/payments.js";

export const config = { api: { bodyParser: false } };

const clean = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return json(response, 405, { error: "Method not allowed" });
  try {
    const actor = await requireAdmin(request);
    if (request.method === "GET") {
      const settings = await wireSettings().catch(error => { if (error.code === "wire_not_configured") return null; throw error; });
      return json(response, 200, { configured: Boolean(settings), settings: settings ? { ...settings, account_number: settings.account_number ? `••••${settings.account_number.slice(-4)}` : "" } : null });
    }
    await rateLimit(service(), "wire_settings", actor.id, 10, 600);
    const body = strictObject(await readJson(request), ["bank_name","beneficiary_name","routing_number","account_number","swift_code","bank_address","notes","reason"]);
    const settings = {
      bank_name: clean(body.bank_name), beneficiary_name: clean(body.beneficiary_name),
      routing_number: clean(body.routing_number, 30), account_number: clean(body.account_number, 50),
      swift_code: clean(body.swift_code, 30).toUpperCase(), bank_address: clean(body.bank_address, 300), notes: clean(body.notes, 500),
    };
    if (!settings.bank_name || !settings.beneficiary_name || !settings.routing_number || !settings.account_number) return json(response, 400, { error: "Bank, beneficiary, routing number, and account number are required" });
    if (!/^\d{9}$/.test(settings.routing_number) || !/^\d{4,34}$/.test(settings.account_number)) return json(response,400,{error:"Enter valid routing and account numbers."});
    if (clean(body.reason,1000).length < 3) return json(response,400,{error:"Enter a reason for this change."});
    if (settings.swift_code && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(settings.swift_code)) return json(response,400,{error:"Enter an 8- or 11-character SWIFT/BIC, or leave it blank for domestic wires."});
    const {error:saveError}=await service().rpc("save_wire_settings_audited",{p_actor:actor.id,p_settings:settings,p_reason:clean(body.reason,1000)});
    if(saveError) throw saveError;
    return json(response, 200, { success: true, account_last4: settings.account_number.slice(-4) });
  } catch (error) {
    securityLog("wire_settings_failed",error);
    return json(response, error.status || 500, { error: error.status ? error.message : request.method === "GET" ? "Wire settings could not be loaded. Please retry." : "Wire settings could not be saved" });
  }
}
