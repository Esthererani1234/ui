import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

import { checkSession, rateLimit, readObject, safeLog } from "../_shared/security.ts";

const allowedOrigins = new Set(["https://goldonthespot.com", "https://www.goldonthespot.com", "http://localhost:5173"]);
const vercelOrigin = /^https:\/\/ui-[a-z0-9-]+-esther-eranis-projects\.vercel\.app$/;
const originAllowed = (origin: string) => allowedOrigins.has(origin) || vercelOrigin.test(origin);
const cors = (req: Request) => ({
  ...(originAllowed(req.headers.get("origin") || "") ? { "access-control-allow-origin": req.headers.get("origin") || "" } : {}),
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json", "cache-control": "no-store" } });
const clean = (value: unknown, max = 5000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const defaultKey = (modern: string, legacy: string) => {
  const value = Deno.env.get(modern);
  if (value) return JSON.parse(value).default as string;
  return Deno.env.get(legacy) || "";
};
const jwtClaims = (token: string) => {
  try {
    const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))) as Record<string, unknown>;
  } catch { return {}; }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return originAllowed(req.headers.get("origin") || "") ? new Response("ok", { headers: cors(req) }) : new Response("Forbidden", { status: 403 });
  if (req.method !== "POST" || !originAllowed(req.headers.get("origin") || "")) return json(req, { error: "Not allowed" }, 403);
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return json(req, { error: "Sign in required" }, 401);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const pub = defaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secret = defaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(url, pub, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(auth.slice(7));
    if (userError || !user) return json(req, { error: "Session expired" }, 401);
    const adminClient = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: adminMembership, error: membershipError } = await adminClient.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    const claims = jwtClaims(auth.slice(7));
    const isAdmin = Boolean(adminMembership) && claims.aal === "aal2";
    if (adminMembership && !isAdmin) return json(req, { error: "Admin two-factor verification required" }, 403);
    await checkSession(adminClient, user.id, String(claims.session_id || ""), !isAdmin);
    await rateLimit(adminClient, "support_action", user.id, 20, 600);
    const body = await readObject(req, 15000);
    const action = clean(body.action, 30);
    const fields = action === "create" ? ["action","request_id","category","subject","message","order_number"] : ["action","request_id","ticket_id","message","status","expected_updated_at"];
    if (Object.keys(body).some(key => !fields.includes(key))) return json(req, { error: "Request contains invalid fields." }, 400);
    if (!["create","reply","status","close","reopen"].includes(action)) return json(req,{error:"Invalid support action"},400);
    const ticketId = action === "create" ? null : Number(body.ticket_id);
    if (action !== "create" && (!Number.isSafeInteger(ticketId) || Number(ticketId)<=0)) return json(req,{error:"Invalid ticket"},400);
    if (!isAdmin && (action === "status" || body.status != null)) return json(req,{error:"Administrator access required"},403);
    const requestId = body.request_id || crypto.randomUUID();
    if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return json(req,{error:"Invalid request reference"},400);
    if (body.expected_updated_at && (typeof body.expected_updated_at !== "string" || !Number.isFinite(Date.parse(body.expected_updated_at)))) return json(req,{error:"Refresh the ticket before saving."},400);
    if (["message","subject","category","order_number","status"].some(key => body[key]!=null && typeof body[key]!=="string")) return json(req,{error:"Check the support form fields."},400);
    const { data, error } = await adminClient.rpc("support_ticket_action", {
      p_actor:user.id,p_admin:isAdmin,p_request_id:requestId,p_action:action,p_ticket_id:ticketId,
      p_message:body.message?.trim() || null,p_status:body.status || null,p_expected_updated_at:body.expected_updated_at || null,
      p_category:body.category || null,p_subject:body.subject?.trim() || null,p_order_number:body.order_number?.trim() || null,
    });
    if (error) {
      const failures:Record<string,[number,string]> = {
        P2002:[404,"This ticket is unavailable."],
        P2003:[409,"This ticket changed. Refresh the conversation before saving; your draft has been kept."],
        P2004:[400,"Enter an order number from your account, or leave it blank."],
        "22023":[400,"Check your ticket details, reply length, and selected status."],
        "42501":[403,"You do not have access to this support action."],
      };
      if(error.code==="P0001" && error.message?.includes("rate limit")) return json(req,{error:"Too many new tickets. Please continue an existing conversation or try again later."},429);
      if(failures[error.code]) return json(req,{error:failures[error.code][1]},failures[error.code][0]);
      throw error;
    }
    return json(req,data);

  } catch (error) {
    safeLog("support_error", error);
    const safe = error as {status?: number; message?: string};
    return json(req, { error: safe.status && safe.status < 500 ? safe.message : "Support request could not be completed" }, safe.status || 500);
  }
});
