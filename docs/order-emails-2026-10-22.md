# Customer order emails — October 22, 2026

Nine navy-and-gold HTML and plain-text templates: order received, awaiting payment, payment received, processing, shipped, delivered, cancelled, refunded, and tracking updated. Include trusted product photos, line-item quantities/prices, order totals, shipping address, and authenticated order links. Tracking is included only when recorded. Cancellation does not claim a refund.

Order state changes enqueue durable notifications in the same database transaction. Only the owner's verified Auth email receives them. No historical orders are backfilled. Milestone uniqueness prevents duplicate webhook notifications. Obsolete, never-attempted notifications are superseded. Locked claims, frozen payloads, provider idempotency keys, bounded retries, and a 22-hour retry cutoff protect against duplicates after an ambiguous send. Failures remain visible in admin activity. Accepted by the provider does not guarantee inbox delivery.

Queue and credential RPCs are service-only; the outbox has RLS and no anonymous/customer grants. Provider configuration requires a valid admin session and authenticator MFA, rate limits, strict fields, verified-domain addresses, and an audit entry. Credentials are encrypted in Vault. Samples go only to the requesting administrator's verified email. The worker uses an independent Vault-backed secret and does not accept customer tokens. The database scheduler wakes it every minute while enabled with work pending.

## Activation

Open Admin → Security → Customer order emails. Enter a Resend sending API key authorized for the verified `goldonthespot.com` domain; verify the sender/reply-to mailboxes. Click **Connect & send sample to me**. Only after the provider accepts the sample are future notifications enabled. The existing Supabase Auth SMTP connection is unchanged. No order-email sending credential was available in the production app at implementation time, so the feature remains off until this step.

## Validation

18 targeted email/API/database tests passed, plus the existing 61 signup/security tests and production build. Browser fixtures verified admin configuration at desktop/mobile sizes and all nine email layouts at 600px, 390px, and 320px. Tests sent no real emails and changed no customer orders. Security panel checkbox overflow was fixed.

## Temporary shipping test

Owner requested shipping removal during this work. Production `app_settings.shipping_flat` changed from 35 to 0 with audit action `store.shipping_test_override`. Existing orders/price locks were not rewritten. Restore the fee to 35 in Admin → Store settings after testing. No automatic restoration date was requested.

## Recovery

Pause order emails in Admin → Security to stop enqueueing/delivery. The cron can be unscheduled with `cron.unschedule('gold-order-emails')`. Retain the outbox and audit records for reconciliation. Never blindly resend an uncertain delivery beyond the provider's deduplication window.
