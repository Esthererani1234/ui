import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

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
    const { data: adminMembership } = await adminClient.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    const body = await req.json();
    const action = clean(body.action, 30);
    const ticketId = Number(body.ticket_id);
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return json(req, { error: "Invalid ticket" }, 400);
    const { data: ticket } = await adminClient.from("support_tickets").select("id,ticket_number,user_id,subject,status").eq("id", ticketId).maybeSingle();
    if (!ticket) return json(req, { error: "Ticket not found" }, 404);
    const isAdmin = Boolean(adminMembership) && jwtClaims(auth.slice(7)).aal === "aal2";
    if (adminMembership && !isAdmin) return json(req, { error: "Admin two-factor verification required" }, 403);
    if (!isAdmin && ticket.user_id !== user.id) return json(req, { error: "Access denied" }, 403);
    if (action === "reply") {
      const message = clean(body.message);
      if (message.length < 2) return json(req, { error: "Write a reply before sending" }, 400);
      const role = isAdmin ? "admin" : "customer";
      const { error: insertError } = await adminClient.from("support_ticket_messages").insert({ ticket_id: ticketId, author_user_id: user.id, author_role: role, message });
      if (insertError) throw insertError;
      const requestedStatus = clean(body.status, 20);
      const nextStatus = isAdmin && ["open", "in_progress", "resolved", "closed"].includes(requestedStatus) ? requestedStatus : isAdmin ? "resolved" : "open";
      const updates: Record<string, unknown> = { status: nextStatus };
      if (isAdmin) updates.admin_response = message;
      await adminClient.from("support_tickets").update(updates).eq("id", ticketId);
      return json(req, { ok: true, status: nextStatus, email: { sent: false, configured: false } });
    }
    if (action === "reopen" && !isAdmin) {
      if (!["resolved", "closed"].includes(ticket.status)) return json(req, { error: "This ticket is already open" }, 400);
      await adminClient.from("support_tickets").update({ status: "open" }).eq("id", ticketId);
      return json(req, { ok: true, status: "open" });
    }
    if (action === "close" && !isAdmin) {
      await adminClient.from("support_tickets").update({ status: "closed" }).eq("id", ticketId);
      return json(req, { ok: true, status: "closed" });
    }
    return json(req, { error: "Invalid action" }, 400);
  } catch (error) {
    console.error(error);
    return json(req, { error: "Support request could not be completed" }, 500);
  }
});
