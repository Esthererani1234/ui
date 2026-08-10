import { json, wireSettings } from "../_lib/payments.js";

const paymentDatabaseReady = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  const paymentsEnabled = process.env.PAYMENTS_V2_ENABLED === "true";
  let wireConfigured = false;
  if (paymentsEnabled && paymentDatabaseReady) {
    wireConfigured = await wireSettings().then(() => true).catch(() => false);
  }
  return json(response, 200, {
    enabled: paymentsEnabled,
    stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
    methods: {
      wire: paymentsEnabled && paymentDatabaseReady && wireConfigured,
      card: process.env.PAYMENTS_V2_ENABLED === "true" && paymentDatabaseReady && process.env.STRIPE_ENABLED === "true" && Boolean(process.env.STRIPE_SECRET_KEY),
      embedded_card: process.env.PAYMENTS_V2_ENABLED === "true"
        && paymentDatabaseReady
        && process.env.STRIPE_ENABLED === "true"
        && Boolean(process.env.STRIPE_SECRET_KEY)
        && Boolean(process.env.STRIPE_PUBLISHABLE_KEY),
      crypto: process.env.PAYMENTS_V2_ENABLED === "true"
        && paymentDatabaseReady
        && process.env.NOWPAYMENTS_ENABLED === "true"
        && Boolean(process.env.NOWPAYMENTS_API_KEY)
        && Boolean(process.env.NOWPAYMENTS_IPN_SECRET),
    },
  });
}
