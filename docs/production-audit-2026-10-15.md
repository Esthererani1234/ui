# Production audit, 2026-10-15

Status: implementation and verification in progress. This is not a certification that every attack path is closed.
Baseline: main 4f148c592e89cd0beec3fee356807b6ac9a38db8, Supabase jwquqphzsnnijopabuhn.

## Confirmed findings and fixes

- **High / availability:** customer and admin order lists selected payment columns without SELECT grants. Reproduced SQLSTATE 42501 as authenticated. Applied a narrow column grant in production; verified query compiles, private notes remain hidden, and absent session returns zero orders.
- **High:** authenticated password-only clients could replace an enrolled SMS phone. New trigger requires proof of the old phone, invalidates SMS sessions after a change, and permits initial enrollment.
- **High:** OTP attempt increments and verification writes raced. Atomic database functions now claim attempts and complete verification once, including profile/session/challenge writes in one transaction.
- **High:** paid SMS sends were counted only after provider success. Durable limits reserve before provider calls, per customer and hashed phone; cross-account phone traffic is limited.
- **High:** provider availability could disable required SMS checks. Server checks now fail closed, verify session existence/expiry/ban/email confirmation, and match SMS session phone to enrolled phone. Private data RLS also validates active sessions.
- **High:** webhook deduplication committed before the order update; retries could lose a payment update. Atomic event/state RPC rolls back both on failure. Stripe also checks canonical intent amount, USD currency, customer, order and provider reference.
- **High:** repeated card tokens could create multiple intents per order. A durable per-order claim serializes distinct confirmations; ambiguous provider failures retain the claim for reconciliation. A stale server total cannot claim a repriced order.
- **High:** out-of-order events could downgrade paid orders or reopen cancellations. Monotonic financial states and guarded fulfillment transitions prevent this. Real late money is recorded for reconciliation without automatically reopening cancelled orders.
- **High:** pending card payments could race repricing/method changes/cancellation. Database guards now block those mutations while payment is unresolved. Attempt amount/currency snapshots remain immutable.
- **Medium:** direct admin order/risk writes bypassed audited operations. Removed direct customer-role writes; added auditing for browser product/config changes, and prevented manually asserting a card-provider settlement.
- **Medium:** risk scoring checked the obsolete native SMS factor and did not run for insert-with-final-total orders. It now recognizes custom verification and runs on insertion; private admin-configured value thresholds contribute to review decisions.
- **Medium:** expensive endpoint limits absent/inconsistent. Added durable limits to quote, card confirm, checkout creation, method change, support actions, admin actions, bank settings, password update, analytics and SMS. AI limiter now service-only with fail-closed callers.
- **Medium:** six dependency packages flagged by npm audit. Patched React Router and transitive nanoid/PostCSS/qs/source-map-js. Audit after updates: zero known findings, including development dependencies.
- **Reliability:** admin refresh keeps last good data, exposes retry, guards stale responses; audit/risk panels display failures instead of false empty lists. Auth callback hydration defers until the auth lock is released. Account load handles rejected requests.

## Baseline protections retained

All public tables have RLS. Service-only payment/OTP tables intentionally have no customer policies. Admin requires verified user, native AAL2 and membership. No user_metadata authorization. Order pricing uses server market data and database premiums; quote consumption/inventory writes lock rows. Webhook signatures verified over raw payloads. Public product storage restricts MIME types and upload size. Existing CSP/HSTS/nosniff/clickjacking/referrer headers retained. Browser receives publishable Supabase identifiers only, not service credentials.

## Verification

Automated PostgreSQL/PGlite regression fixtures cover IDOR, revoked/banned/wrong-owner sessions, phone replacement, OTP limits/expiry/replay, rate reservations, card request claims, stale totals, expired locks, webhook duplicates/rollback/out-of-order events, cancelled paid orders, risk scoring, fulfillment holds and audited wire marking. These use synthetic data, not customer records. PGlite serializes requests; this does not constitute a real multi-connection load test.

Node tests cover strict JSON/cart/payment payloads, invalid/expired/cancelled order payment guards, exact Stripe amount/identity matching, unknown notifications and partial refunds, and fail-closed rate errors. Existing signup completion/search checks and Vite production build pass.

Deno type checking uses exact source copies with only the JSR runtime type-only import removed because the local JSR host is unreachable; npm Supabase imports and shared security modules are checked. Live Edge deploy bundling must also succeed.

## Remaining release/operational gaps

- Native Supabase email password-recovery/update endpoints do not inherently enforce this custom Bird second factor. The app endpoint checks recovery SMS, but native Auth bypass resistance requires a supported native MFA/recovery design and dedicated end-to-end testing. Do not describe custom reset SMS as universally enforced.
- Card authentication can complete after a price lock expires. Initiation is guarded and late settlements are held for review, but strict prevention of late capture needs a tested manual-capture/cancellation flow. Do not certify that no late card charge can occur.
- An ambiguous provider error or failed local recording intentionally holds an order against a second charge. Reconcile against Stripe before clearing any claim; never expire claims based only on elapsed time. Automated reconciliation/recovery remains to be implemented and verified.
- Real Stripe/3DS, duplicate-provider delivery, actual email/SMS, sign-in/password-reset and authenticated admin browser flows require a safe test account/provider test environment. No live customer messages, charges or test orders were generated.
- Leaked-password protection is disabled in Supabase Auth. Enable in Auth settings when the project plan supports it, and verify signup/reset behavior.
- Tax calculation is not implemented in the inspected quote/order flow. Confirm business tax rules and configure a vetted tax calculation before certifying checkout totals for all destinations.
- Backup/PITR entitlement, retention and an actual restore drill have not been verified.
- No comprehensive git-history secret scan, global fraud telemetry/alerts or sustained multi-instance load test has been completed. Browser auth still uses the existing Supabase SPA storage architecture.
- SQL migration rollback should preserve audit/payment rows. Reverting server code requires compatible RPCs; do not drop ledgers or reset production. Restore function definitions from the previous revision only with security implications reviewed.

## Deployment order

1. Scoped order-read grant (already applied).
2. Authentication/payment guard migration; fraud/audit migration.
3. Customer SMS, create-order, support/admin and store-assistant Edge functions.
4. Vercel application commit (matching shared security code).
5. AI limiter grant restriction after both server callers use service credentials.
6. Verify grants/RLS/advisors, unsigned payment and unauthenticated API rejection, public catalog/images/pricing, deployed commit.
