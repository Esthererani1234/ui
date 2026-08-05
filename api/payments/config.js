import { json } from "../_lib/payments.js";

const paymentDatabaseReady = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

export default function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  return json(response, 200, {
    enabled: process.env.PAYMENTS_V2_ENABLED === "true",
    methods: {
      wire: process.env.PAYMENTS_V2_ENABLED === "true" && paymentDatabaseReady && Boolean(process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY),
      card: process.env.PAYMENTS_V2_ENABLED === "true" && paymentDatabaseReady && process.env.STRIPE_ENABLED === "true" && Boolean(process.env.STRIPE_SECRET_KEY),
      crypto: process.env.PAYMENTS_V2_ENABLED === "true"
        && paymentDatabaseReady
        && process.env.NOWPAYMENTS_ENABLED === "true"
        && Boolean(process.env.NOWPAYMENTS_API_KEY)
        && Boolean(process.env.NOWPAYMENTS_IPN_SECRET),
    },
  });
}
