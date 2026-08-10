import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// The project URL and publishable key are public identifiers already used by
// the storefront. Keeping the same fallback here prevents serverless checkout
// auth from drifting away from the working browser auth configuration.
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || "https://jwquqphzsnnijopabuhn.supabase.co";
const SUPABASE_PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || "sb_publishable_UmuOpNm2x13dOqlv1jL3Og_XSQtFuHV";
// Prefer Supabase's independently rotatable modern server secret. Continue
// accepting the legacy service-role name so existing deployments keep working.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const service = () => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Payment service is not configured");
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
};

export const json = (response, status, body) => {
  response.status(status).setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
};

export async function readJson(request, maxBytes = 30_000) {
  const raw = await readRaw(request, maxBytes);
  try { return JSON.parse(raw.toString("utf8")); }
  catch { throw new Error("Request must contain valid JSON"); }
}

export async function readRaw(request, maxBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function authenticateCustomer(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sign in required"), { status: 401 });
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) throw new Error("Authentication service is not configured");
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !user) throw Object.assign(new Error("Your session expired"), { status: 401 });
  return { user, token: authorization.slice(7) };
}

export async function requireAdmin(request) {
  const { user, token } = await authenticateCustomer(request);
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (payload.aal !== "aal2") throw Object.assign(new Error("Two-factor verification required"), { status: 403 });
  const { data } = await service().from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) throw Object.assign(new Error("Administrator access required"), { status: 403 });
  return user;
}

export async function customerOrder(orderId, userId) {
  const { data, error } = await service().from("orders")
    .select("id,order_number,user_id,email,first_name,last_name,phone,payment_method,payment_status,payment_provider,provider_payment_id,provider_checkout_url,payment_reference,payment_due_at,subtotal,payment_surcharge,shipping_amount,total,spot_snapshot,price_locked_until,status,shipping_address,order_items(id,product_id,product_name,quantity,unit_price,line_total,products(image_url,image_urls))")
    .eq("id", orderId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Order not found"), { status: 404 });
  return data;
}

export function assertPayable(order, method) {
  if (order.payment_method !== method) throw Object.assign(new Error("Payment method does not match this order"), { status: 409 });
  if (["paid", "refunded", "disputed"].includes(order.payment_status)) throw Object.assign(new Error("This order cannot accept another payment"), { status: 409 });
  if (order.price_locked_until && Date.now() > new Date(order.price_locked_until).getTime()) throw Object.assign(new Error("The price lock expired. Return to your cart for a new live quote."), { status: 409 });
}

export const safeProviderPayload = (payload) => {
  if (!payload || typeof payload !== "object") return {};
  // Keep only reconciliation fields. Wallet/deposit addresses and customer
  // details are deliberately excluded from our database event snapshots.
  const allowed = [
    "id", "status", "price", "currency", "createdTime", "expirationTime",
    "exceptionStatus", "paymentSubtotals", "paymentTotals", "payment_id",
    "invoice_id", "payment_status", "price_amount", "price_currency",
    "pay_amount", "actually_paid", "pay_currency", "purchase_id", "order_id",
    "order_description", "created_at", "updated_at", "outcome_amount",
    "outcome_currency", "invoice_url",
  ];
  return Object.fromEntries(allowed.filter((key) => key in payload).map((key) => [key, payload[key]]));
};

export async function insertAttempt(order, provider, providerId, status, checkoutUrl, expiresAt, providerPayload = {}) {
  const db = service();
  const { error } = await db.from("payment_attempts").upsert({
    order_id: order.id, provider, provider_payment_id: providerId, status,
    amount: order.total, currency: "USD", checkout_url: checkoutUrl || null,
    expires_at: expiresAt || null, provider_payload: safeProviderPayload(providerPayload), updated_at: new Date().toISOString(),
  }, { onConflict: "provider,provider_payment_id" });
  if (error) throw error;
  const paid = status === "paid";
  let orderUpdate = db.from("orders").update({
    payment_provider: provider, provider_payment_id: providerId || null,
    provider_checkout_url: checkoutUrl || null, payment_due_at: expiresAt || order.price_locked_until,
    payment_status: paid ? "paid" : provider === "manual_wire" ? "pending" : "unpaid",
    status: paid ? "payment_received" : "awaiting_payment",
    ...(paid ? { paid_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id);
  // A late API response must not downgrade an order that a verified webhook
  // already moved into a terminal payment state.
  if (!paid) orderUpdate = orderUpdate.not("payment_status", "in", "(paid,refunded,disputed)");
  const { error: orderError } = await orderUpdate;
  if (orderError) throw orderError;
}

export async function recordEvent(provider, eventId, orderId, eventType, verified, payload) {
  const { data, error } = await service().from("payment_events").upsert({
    provider, provider_event_id: eventId, order_id: orderId || null, event_type: eventType,
    verified, payload: safeProviderPayload(payload), processed_at: new Date().toISOString(), error_message: null,
  }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function sendPaymentEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.PAYMENTS_FROM_EMAIL) return { sent: false, reason: "Email provider is not configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.PAYMENTS_FROM_EMAIL, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error("Payment email could not be sent");
  return { sent: true };
}

export function nextWirePaymentDeadline(now = new Date()) {
  const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) {
    due.setUTCDate(due.getUTCDate() + 1);
  }
  return due.toISOString();
}

const encryptionKey = () => {
  const raw = process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PAYMENT_SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
};

export function encryptSettings(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64") };
}

export function decryptSettings(row) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

export async function wireSettings() {
  const { data: vaulted, error: vaultError } = await service().rpc("get_wire_instructions_secret");
  if (!vaultError && vaulted) return typeof vaulted === "string" ? JSON.parse(vaulted) : vaulted;

  if (process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY) {
    const { data, error } = await service().from("secure_payment_settings").select("ciphertext,iv,auth_tag").eq("key", "wire_instructions").maybeSingle();
    if (error) throw error;
    if (data) return decryptSettings(data);
  }

  if (vaultError && vaultError.code !== "PGRST202") throw vaultError;
  throw Object.assign(new Error("Wire instructions have not been configured"), { status: 503 });
}

export async function saveWireSettings(settings) {
  const { error: vaultError } = await service().rpc("set_wire_instructions_secret", { secret_value: settings });
  if (!vaultError) return;

  if (process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY) {
    const encrypted = encryptSettings(settings);
    const { error } = await service().from("secure_payment_settings").upsert({ key: "wire_instructions", ...encrypted, updated_at: new Date().toISOString() });
    if (!error) return;
    throw error;
  }

  throw vaultError;
}

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
