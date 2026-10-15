import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.6";
export async function checkSession(db: SupabaseClient, userId: string, sessionId: string, sms = false) {
  const { data, error } = await db.rpc("check_customer_session", { p_user_id: userId, p_session_id: sessionId, p_require_sms: sms });
  if (error) throw Object.assign(new Error("Security checks are temporarily unavailable."), { status: 503 });
  if (data !== true) throw Object.assign(new Error(sms ? "Verify your SMS security code before continuing." : "Your session expired. Please sign in again."), { status: sms ? 403 : 401 });
}
export async function rateLimit(db: SupabaseClient, scope: string, subject: string, limit: number, seconds: number) {
  const { data, error } = await db.rpc("consume_security_rate_limit", { p_scope: scope, p_subject: subject, p_limit: limit, p_seconds: seconds });
  if (error || !Number.isInteger(data)) throw Object.assign(new Error("Security checks are temporarily unavailable."), { status: 503 });
  if (data > 0) throw Object.assign(new Error(`Too many requests. Try again in ${data} seconds.`), { status: 429, retry_after: data });
}
export async function hashSubject(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function readObject(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("Request must contain valid JSON."), { status: 400 });
  let size=0; const chunks: Uint8Array[]=[];
  while (true) {
    const {value,done}=await reader.read(); if(done) break;
    size+=value.length;
    if(size>maximum) { await reader.cancel(); throw Object.assign(new Error("Request is too large."), {status:413}); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  try {
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(!body || typeof body!=="object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw Object.assign(new Error("Request must contain a JSON object."), {status:400}); }
}
export function safeLog(event: string, error: unknown) {
  const code=(error as {code?:unknown})?.code;
  console.error(event,{code:typeof code==="string" && /^[a-z0-9_]{1,60}$/i.test(code)?code:"internal_error"});
}
