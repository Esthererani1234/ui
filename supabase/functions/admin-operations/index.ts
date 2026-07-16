import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const allowedOrigins = new Set([
  "https://goldonthespot.com",
  "https://www.goldonthespot.com",
  "https://ui-plum-alpha.vercel.app",
  "https://ui-git-agent-goldonthespot-store-esther-eranis-projects.vercel.app",
  "http://localhost:5173",
]);

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    ...(allowedOrigins.has(origin)
      ? { "access-control-allow-origin": origin }
      : {}),
    "access-control-allow-headers":
      "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
};

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const readDefaultKey = (modernName: string, legacyName: string) => {
  const modern = Deno.env.get(modernName);
  if (modern) return JSON.parse(modern).default as string;
  return Deno.env.get(legacyName) || "";
};

const jwtPayload = (token: string) => {
  try {
    const encoded = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const cleanText = (value: unknown, limit: number) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin") || "";
    if (!allowedOrigins.has(origin))
      return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST")
    return json(request, { error: "Method not allowed" }, 405);
  if (!allowedOrigins.has(request.headers.get("origin") || ""))
    return json(request, { error: "Origin not allowed" }, 403);
  if (Number(request.headers.get("content-length") || 0) > 30_000)
    return json(request, { error: "Request is too large" }, 413);

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer "))
      return json(request, { error: "Administrator sign-in required" }, 401);

    const token = authHeader.slice(7);
    const claims = jwtPayload(token);
    if (claims.aal !== "aal2")
      return json(request, { error: "Two-factor verification required" }, 403);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = readDefaultKey(
      "SUPABASE_PUBLISHABLE_KEYS",
      "SUPABASE_ANON_KEY",
    );
    const secretKey = readDefaultKey(
      "SUPABASE_SECRET_KEYS",
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    if (!supabaseUrl || !publishableKey || !secretKey)
      throw new Error("Admin service is not configured");

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: actor },
      error: userError,
    } = await userClient.auth.getUser(token);
    if (userError || !actor)
      return json(request, { error: "Your session expired" }, 401);

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: membership } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (!membership)
      return json(request, { error: "Administrator access required" }, 403);

    const body = await request.json();
    const action = cleanText(body?.action, 80);
    const audit = async (
      auditAction: string,
      targetType: string,
      targetId: string | null,
      reason: string,
      metadata: Record<string, unknown> = {},
    ) => {
      const { error } = await admin.from("admin_audit_log").insert({
        actor_user_id: actor.id,
        action: auditAction,
        target_type: targetType,
        target_id: targetId,
        reason: reason || null,
        metadata,
      });
      if (error) throw error;
    };

    if (action === "get_order_details") {
      const orderId = Number(body?.order_id);
      if (!Number.isInteger(orderId) || orderId < 1)
        return json(request, { error: "Invalid order" }, 400);
      const { data: order, error } = await admin
        .from("orders")
        .select("id, order_number, user_id, first_name, last_name, email, phone, status, payment_status, payment_method, subtotal, payment_surcharge, shipping_amount, insurance_amount, total, spot_snapshot, price_locked_until, shipping_address, customer_notes, internal_notes, tracking_number, created_at, updated_at, order_items(*)")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      if (!order) return json(request, { error: "Order not found" }, 404);
      return json(request, { order });
    }

    if (action === "sales_report") {
      const days = Number(body?.days);
      if (![0, 7, 30, 90, 365].includes(days))
        return json(request, { error: "Invalid sales report period" }, 400);
      let salesQuery = admin
        .from("orders")
        .select("id, status, payment_method, total, created_at, order_items(product_name, metal, quantity, line_total)")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (days)
        salesQuery = salesQuery.gte(
          "created_at",
          new Date(Date.now() - days * 86_400_000).toISOString(),
        );
      const { data: orders, error } = await salesQuery;
      if (error) throw error;
      const productTotals = new Map<string, { name: string; units: number; sales: number }>();
      const metalTotals = new Map<string, { metal: string; units: number; sales: number }>();
      const statuses: Record<string, number> = {};
      const payments: Record<string, number> = {};
      let grossSales = 0;
      let units = 0;
      for (const order of orders || []) {
        grossSales += Number(order.total || 0);
        statuses[order.status] = (statuses[order.status] || 0) + 1;
        payments[order.payment_method] = (payments[order.payment_method] || 0) + 1;
        for (const item of order.order_items || []) {
          const quantity = Number(item.quantity || 0);
          const lineSales = Number(item.line_total || 0);
          units += quantity;
          const product = productTotals.get(item.product_name) || {
            name: item.product_name,
            units: 0,
            sales: 0,
          };
          product.units += quantity;
          product.sales += lineSales;
          productTotals.set(item.product_name, product);
          const metalName = item.metal || "other";
          const metal = metalTotals.get(metalName) || {
            metal: metalName,
            units: 0,
            sales: 0,
          };
          metal.units += quantity;
          metal.sales += lineSales;
          metalTotals.set(metalName, metal);
        }
      }
      const orderCount = orders?.length || 0;
      return json(request, {
        report: {
          days,
          order_count: orderCount,
          gross_sales: Math.round(grossSales * 100) / 100,
          average_order: orderCount
            ? Math.round((grossSales / orderCount) * 100) / 100
            : 0,
          units,
          statuses,
          payments,
          top_products: [...productTotals.values()]
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10),
          metals: [...metalTotals.values()].sort((a, b) => b.sales - a.sales),
        },
      });
    }

    if (action === "list_customers") {
      const { data: userPage, error: listError } =
        await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      const users = userPage.users || [];
      const ids = users.map((user) => user.id);
      const [profilesResult, riskResult, ordersResult, mfaResult] =
        await Promise.all([
          ids.length
            ? admin.from("profiles").select("*").in("id", ids)
            : Promise.resolve({ data: [] }),
          ids.length
            ? admin.from("customer_risk_profiles").select("*").in("user_id", ids)
            : Promise.resolve({ data: [] }),
          ids.length
            ? admin
                .from("orders")
                .select("id, user_id, order_number, status, total, created_at")
                .in("user_id", ids)
                .order("created_at", { ascending: false })
                .limit(5000)
            : Promise.resolve({ data: [] }),
          admin.rpc("admin_customer_security_summary"),
        ]);
      const profiles = new Map(
        (profilesResult.data || []).map((profile) => [profile.id, profile]),
      );
      const risks = new Map(
        (riskResult.data || []).map((risk) => [risk.user_id, risk]),
      );
      const factors = new Map(
        (mfaResult.data || []).map((factor) => [factor.user_id, factor]),
      );
      const ordersByUser = new Map<string, Array<Record<string, unknown>>>();
      for (const order of ordersResult.data || []) {
        const current = ordersByUser.get(order.user_id) || [];
        current.push(order);
        ordersByUser.set(order.user_id, current);
      }
      const query = cleanText(body?.query, 160).toLowerCase();
      const customers = users
        .map((user) => {
          const profile = profiles.get(user.id) || {};
          const risk = risks.get(user.id) || {};
          const orders = ordersByUser.get(user.id) || [];
          return {
            id: user.id,
            email: user.email || "",
            phone: user.phone || profile.phone || "",
            email_confirmed_at: user.email_confirmed_at,
            phone_confirmed_at: user.phone_confirmed_at,
            created_at: user.created_at,
            last_sign_in_at: user.last_sign_in_at,
            banned_until: user.banned_until,
            providers: user.app_metadata?.providers || [],
            profile,
            risk,
            has_phone_mfa: Boolean(factors.get(user.id)?.has_phone_mfa),
            has_any_mfa: Boolean(factors.get(user.id)?.has_any_mfa),
            order_count: orders.length,
            lifetime_value: orders.reduce(
              (sum, order) => sum + Number(order.total || 0),
              0,
            ),
            orders: orders.slice(0, 20),
          };
        })
        .filter((customer) =>
          query
            ? `${customer.email} ${customer.phone} ${customer.profile.first_name || ""} ${customer.profile.last_name || ""} ${customer.id}`
                .toLowerCase()
                .includes(query)
            : true,
        );
      return json(request, { customers, total: customers.length });
    }

    if (action === "update_customer_risk") {
      const userId = cleanText(body?.user_id, 80);
      const status = cleanText(body?.status, 20);
      const riskScore = Number(body?.risk_score);
      const reason = cleanText(body?.reason, 1000);
      const notes = cleanText(body?.internal_notes, 5000);
      const tags = Array.isArray(body?.tags)
        ? body.tags
            .map((tag: unknown) => cleanText(tag, 50))
            .filter(Boolean)
            .slice(0, 20)
        : [];
      if (!userId || !["normal", "watch", "review", "blocked"].includes(status))
        return json(request, { error: "Invalid customer risk update" }, 400);
      if (!Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100)
        return json(request, { error: "Risk score must be from 0 to 100" }, 400);
      if (reason.length < 3)
        return json(request, { error: "Enter a reason for this change" }, 400);
      const { error } = await admin.from("customer_risk_profiles").upsert({
        user_id: userId,
        status,
        risk_score: riskScore,
        tags,
        manual_review_required: Boolean(body?.manual_review_required),
        checkout_disabled: Boolean(body?.checkout_disabled),
        internal_notes: notes || null,
        updated_by: actor.id,
      });
      if (error) throw error;
      await audit("customer.risk_updated", "customer", userId, reason, {
        status,
        risk_score: riskScore,
        tags,
        manual_review_required: Boolean(body?.manual_review_required),
        checkout_disabled: Boolean(body?.checkout_disabled),
      });
      return json(request, { success: true });
    }

    if (action === "set_customer_access") {
      const userId = cleanText(body?.user_id, 80);
      const suspended = Boolean(body?.suspended);
      const reason = cleanText(body?.reason, 1000);
      if (!userId || reason.length < 3)
        return json(request, { error: "Customer and reason are required" }, 400);
      if (userId === actor.id)
        return json(request, { error: "You cannot suspend your own account" }, 400);
      const { data: targetAdmin } = await admin
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (targetAdmin)
        return json(request, { error: "Admin accounts cannot be changed here" }, 400);
      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: suspended ? "876000h" : "none",
      });
      if (authError) throw authError;
      const { error: riskError } = await admin
        .from("customer_risk_profiles")
        .update({
          status: suspended ? "blocked" : "normal",
          checkout_disabled: suspended,
          updated_by: actor.id,
        })
        .eq("user_id", userId);
      if (riskError) throw riskError;
      await audit(
        suspended ? "customer.suspended" : "customer.restored",
        "customer",
        userId,
        reason,
      );
      return json(request, { success: true });
    }

    if (action === "send_auth_email") {
      const email = cleanText(body?.email, 320).toLowerCase();
      const type = cleanText(body?.email_type, 30);
      const reason = cleanText(body?.reason, 1000);
      if (!email || !["recovery", "confirmation"].includes(type))
        return json(request, { error: "Invalid email request" }, 400);
      const publicClient = createClient(supabaseUrl, publishableKey);
      const redirectTo = "https://goldonthespot.com/login?recovery=1";
      const result =
        type === "recovery"
          ? await publicClient.auth.resetPasswordForEmail(email, { redirectTo })
          : await publicClient.auth.resend({
              type: "signup",
              email,
              options: { emailRedirectTo: "https://goldonthespot.com/account" },
            });
      if (result.error) throw result.error;
      await audit(`customer.${type}_email_sent`, "customer", email, reason);
      return json(request, { success: true });
    }

    if (action === "review_order") {
      const orderId = Number(body?.order_id);
      const decision = cleanText(body?.decision, 20);
      const reason = cleanText(body?.reason, 1000);
      const notes = cleanText(body?.admin_notes, 5000);
      if (!Number.isInteger(orderId) || !["pending", "approved", "rejected"].includes(decision))
        return json(request, { error: "Invalid order review" }, 400);
      if (reason.length < 3)
        return json(request, { error: "Enter a review reason" }, 400);
      const { error } = await admin
        .from("order_risk_reviews")
        .update({
          decision,
          admin_notes: notes || null,
          reviewed_by: actor.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);
      if (error) throw error;
      await audit("order.risk_reviewed", "order", String(orderId), reason, {
        decision,
      });
      return json(request, { success: true });
    }

    if (action === "update_order") {
      const { data, error } = await admin.rpc("admin_update_order", {
        p_actor_user_id: actor.id,
        p_order_id: Number(body?.order_id),
        p_status: cleanText(body?.status, 30),
        p_payment_status: cleanText(body?.payment_status, 30),
        p_tracking_number: cleanText(body?.tracking_number, 200),
        p_internal_notes: cleanText(body?.internal_notes, 5000),
        p_reason: cleanText(body?.reason, 1000),
      });
      if (error) throw error;
      return json(request, data);
    }

    if (action === "update_security_settings") {
      const providerName = cleanText(body?.sms_provider_name, 30).toLowerCase();
      const smsSender = cleanText(body?.sms_sender, 30);
      const providerReady = Boolean(body?.sms_provider_ready);
      const smsRequired = Boolean(body?.customer_sms_mfa_required);
      const emailReady = Boolean(body?.branded_email_ready);
      const reason = cleanText(body?.reason, 1000);
      if (!["twilio", "vonage", "messagebird"].includes(providerName))
        return json(request, { error: "Choose a supported SMS provider" }, 400);
      if (smsSender && !/^\+?[0-9 ()-]{7,30}$/.test(smsSender))
        return json(request, { error: "Enter a valid SMS sender number" }, 400);
      if (smsRequired && !providerReady)
        return json(request, { error: "Connect and test the SMS provider first" }, 400);
      if (reason.length < 3)
        return json(request, { error: "Enter a reason for this security change" }, 400);
      const rows = [
        { key: "sms_provider_name", value: providerName, is_public: true },
        { key: "sms_sender", value: smsSender, is_public: true },
        { key: "sms_provider_ready", value: providerReady, is_public: true },
        { key: "customer_sms_mfa_required", value: smsRequired, is_public: true },
        { key: "branded_email_ready", value: emailReady, is_public: true },
      ];
      const { error } = await admin.from("app_settings").upsert(rows);
      if (error) throw error;
      await audit("security.settings_updated", "security", "auth", reason, {
        sms_provider_ready: providerReady,
        customer_sms_mfa_required: smsRequired,
        branded_email_ready: emailReady,
        sms_provider_name: providerName,
      });
      return json(request, { success: true });
    }

    if (action === "update_store_settings") {
      const settings =
        body?.settings && typeof body.settings === "object"
          ? body.settings as Record<string, unknown>
          : {};
      const reason = cleanText(body?.reason, 1000);
      const shippingFlat = Number(settings.shipping_flat);
      const freeShipping = Number(settings.free_shipping_threshold);
      const cardSurcharge = Number(settings.card_surcharge_percent);
      const priceLock = Number(settings.price_lock_minutes);
      const announcement = cleanText(settings.store_announcement, 160);
      if (reason.length < 3)
        return json(request, { error: "Enter a reason for this store change" }, 400);
      if (!Number.isFinite(shippingFlat) || shippingFlat < 0 || shippingFlat > 10_000)
        return json(request, { error: "Shipping fee must be from $0 to $10,000" }, 400);
      if (!Number.isFinite(freeShipping) || freeShipping < 0 || freeShipping > 1_000_000)
        return json(request, { error: "Free-shipping threshold is invalid" }, 400);
      if (!Number.isFinite(cardSurcharge) || cardSurcharge < 0 || cardSurcharge > 10)
        return json(request, { error: "Card surcharge must be from 0% to 10%" }, 400);
      if (!Number.isInteger(priceLock) || priceLock < 1 || priceLock > 30)
        return json(request, { error: "Price lock must be from 1 to 30 minutes" }, 400);
      const rows = [
        { key: "shipping_flat", value: shippingFlat, is_public: true },
        { key: "free_shipping_threshold", value: freeShipping, is_public: true },
        { key: "card_surcharge_percent", value: cardSurcharge, is_public: true },
        { key: "price_lock_minutes", value: priceLock, is_public: true },
        { key: "store_announcement", value: announcement, is_public: true },
        { key: "accepting_orders", value: Boolean(settings.accepting_orders), is_public: true },
      ];
      const { error } = await admin.from("app_settings").upsert(rows);
      if (error) throw error;
      await audit("store.settings_updated", "store", "storefront", reason, {
        shipping_flat: shippingFlat,
        free_shipping_threshold: freeShipping,
        card_surcharge_percent: cardSurcharge,
        price_lock_minutes: priceLock,
        accepting_orders: Boolean(settings.accepting_orders),
        announcement_active: Boolean(announcement),
      });
      return json(request, { success: true });
    }

    return json(request, { error: "Unsupported admin action" }, 400);
  } catch (error) {
    console.error("admin operation failed", error);
    return json(
      request,
      { error: error instanceof Error ? error.message : "Admin operation failed" },
      500,
    );
  }
});
