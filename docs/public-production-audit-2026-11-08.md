# Production audit — 2026-11-08

Baseline main: af3d09743b29322adb099df19353f90819225ace. Production: GoldOnTheSpot.com. This is a bounded engineering audit, not a guarantee of security or a full penetration-test certification.

## Executed checks
- Full `npm run check`: 246 tests passed (9 signup, 147 security/payment/database, 46 email, 44 support/selling/reviews), search checks and Vite production build passed after changes.
- Tests include wrong-owner access, ordinary users calling admin operations, revoked sessions, OTP expiration/attempt limits/replay, duplicate payment events, amount mismatches, price-lock expiration, payment maximums, risk holds, and private attachments. Most use mocked APIs or isolated PGlite fixtures; they are not live transaction tests.
- `npm audit`: zero reported vulnerabilities after Vite patch; initial production-only audit also zero. Initial full audit identified Vite 8.1.4 advisories, including a high-severity development-server/editor issue.
- Live HTTP: homepage, metals feed and payment config returned 200. Quote, card confirmation, ACH confirmation, card completion, wire settings, three admin endpoints and reconciliation rejected unauthenticated requests with 401. Unsigned Stripe webhook returned 400. POST wire-instructions returned 405 (method rejection, not an ownership test).
- Live response headers confirmed CSP, HSTS, nosniff and frame denial.
- Live browser: search for 1kg -> select match -> correct listing -> add to cart -> correct item and amount in cart. Cart product image loaded. Captured console errors were browser-extension errors, not application errors. Desktop only; no new mobile/device matrix executed.
- Live DB: all 34 public/private application tables have RLS enabled; all 42 public SECURITY DEFINER functions denied EXECUTE to anon/authenticated. Session policies are RESTRICTIVE. Anonymous role SELECT saw zero orders. Customer orders/items/support policies require ownership and SMS verification or admin status.
- Private support, selling and review photo buckets restrict image types and size. Product image bucket is intentionally public.
- No currently processing/shipped/delivered/completed orders with payment status outside paid/refunded/disputed. This is a consistency check, not proof every historical payment was legitimate.
- Email queue: 19 sent, 8 skipped, no pending/failed entries at inspection. Email and payment-reconciliation scheduled jobs active. Delivery to recipient inboxes not tested.
- Built JS scan found no Stripe secret key, webhook secret, Supabase secret-key format or private-key PEM patterns. This pattern scan does not prove absence of every possible secret format.
- Vercel project configured Node 24.x; latest baseline production deployment READY. Exact running patch and historical compromise investigation not completed.

## Changes
- package.json/package-lock.json: Vite 8.1.4 -> 8.1.6 (patch update); full audit now zero.
- src/pages/CartPage.jsx: correct misleading no-fee ACH/check copy to ACH 2%, configured card surcharge, wire no processing surcharge. No fee amount changed.
- scripts/check-payment-maximums.mjs: isolated DB regression accepts exactly $1,000,000 wire total and rejects $1,000,000.01.
- Live app_settings.wire_order_maximum: $100,000 -> $1,000,000 at owner request. Maintenance audit records preserved. Card final cap $10,450, ACH final cap $25,000 and crypto configured cap $2,000,000 unchanged. Crypto remains disabled in live payment config. No RLS or order state-machine changes.

## Unresolved risks and limits
1. HIGH business/compliance: no tax columns on orders and no implemented authoritative tax calculation found in checkout. Tax is not verified ready. Do not infer all bullion purchases are exempt. Requires qualified tax determination and implementation; no invented rates or silent fee changes made.
2. MEDIUM: leaked-password protection disabled in Supabase advisor. Review availability and enable; no paid plan upgrade authorized here. https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
3. MEDIUM: two historical quote failures reported by runtime monitoring (latest Nov 7 23:06 UTC). Sanitized internal_error lacks enough detail to establish cause. Live public pricing responded successfully; authenticated quote generation not retested with a real account.
4. MEDIUM hardening: advisor flags pg_net extension in public schema. No blind extension move performed because scheduled workers may depend on it. https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
5. End-to-end card/ACH sandbox settlement, failed-bank returns, real email+SMS reset, customer/admin signed-in journeys, million-dollar real transaction, backup restore and all-device testing remain unexecuted. No real financial transactions performed.
6. Existing card surcharge/debit treatment, insurance promises, product claims, sales tax and legal agreements require professional/business verification; this audit does not approve them.
7. Some direct table grants remain broader than needed but RLS currently denies unauthorized operations. Further least-privilege cleanup should be migration-backed and tested, not conflated with a confirmed exploit.

## Recommendation
Do not treat this pass as full launch clearance for unrestricted high-value fulfillment. Keep payment-clearance and risk-review gates enforced, resolve tax readiness, and complete isolated payment/account end-to-end testing. No confirmed successful unauthorized access or payment forgery in the checks executed.

## Rollback
Revert this code commit to baseline af3d09743b29322adb099df19353f90819225ace if necessary (restores vulnerable Vite build dependency; prefer forward fix). Wire cap can be restored through authorized admin settings to $100,000; preserve audit records and existing orders. No production data deleted or schema weakened.

## Follow-up observed during deployment
A pre-deployment browser tab navigating to Sell to Us failed to fetch a replaced lazy JS chunk and rendered a blank page. Added a top-level AppErrorBoundary with a safe, explicit reload button, order-history link and support link. No automatic reload or payment retry. Added fallback-rendering test; this validates recovery markup and error redaction, not a simulated live chunk outage. After refreshing the live site, retest current assets.
