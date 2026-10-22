# Wire checkout and launch review — 22 October 2026

## Customer flow

Choose wire → read the agreement → explicitly check consent plus purchase terms → place order within the server quote deadline → see the receipt, account/ABA/optional international SWIFT, exact USD amount, reference and Eastern payment deadline. An instruction email with product pictures and an agreement copy is queued in the same database transaction.

The agreement covers documented actual market loss after cancellation/nonpayment of an accepted order, a commercially reasonable resale, saved-expense offsets, mitigation, a merchandise-price cap and an itemized explanation. It authorizes no automatic card charge or bank debit. No new obligations were applied to historical orders. A New York attorney should review the wording and actual order-acceptance/cancellation procedures before launch; this implementation is not a legal opinion on enforceability. Source reviewed: NY UCC 2-718, https://www.nysenate.gov/legislation/laws/UCC/2-718 .

The wire payment deadline is generated once: next day at the same Eastern time, moving weekend deadlines to Monday, always at least 24 hours. Holidays are not automatically skipped; the agreement tells customers to contact support before ordering if cutoffs/holidays cause delay. A customer commits to a wire order during the ten-minute quote window; its accepted wire amount remains fixed for the separately stated wire payment deadline. No overdue instruction page encourages sending an old amount. Late receipts require manual review.

## Verified defects repaired

- Reopening wire checkout previously moved its deadline forward and used a separate, non-durable email sender. Reads now preserve one deadline, and emails use the configured Resend outbox with retry/idempotency protection.
- Order creation and follow-up metadata writes were separate. A metadata failure could leave an order/inventory reservation without the expected acceptance record. The new service-only wrapper commits quote consumption, order, metadata, wire acceptance, email and an idempotent quote→order receipt together.
- Wire agreement text/version, customer, acceptance timestamp, exact total and request user agent are stored server-side. Salted IP hash is recorded only when the existing server salt is configured. Customers cannot set timestamps, amount, bank destination or deadline.
- Consent is separately required for card→wire conversion. Existing in-flight card claims block conversion; a declined card's surcharge is removed by the existing server calculation.
- Bank destination changes and their sanitized audit now commit together. Read outages remain visible rather than resembling an unconfigured bank. Account values stay masked on admin reads.
- Optional checkout address saving no longer overwrites the security-verified phone. It cannot prevent navigation to an already-placed order.
- Checkout errors now display the controlled server response. Mobile fieldset/grid minimum widths and purchase-consent text wrapping are corrected.
- Shipping address lines in email support both the checkout and provider field formats.

## Security and tests

Added strict checkout contact/address/terms schemas; owner/SMS/live-session checks remain. Quote creation still calculates prices server-side. New direct-client RPC/ledger access is revoked, RLS is enabled, customer-readable agreement columns retain existing order-owner/SMS policies, and accepted wire totals/deadlines/text cannot be rewritten. Wire instructions read limit: 60/customer/10 minutes. Existing checkout and payment-change limits remain.

New `check-wire-orders.mjs` and `check-wire-api.mjs` exercise atomic rollback, unknown/old/forged consent, revoked sessions, missing SMS, authenticated email binding, owner/quote IDOR, repeated submissions, stock preservation, fixed deadline, expired quote/deadline, in-flight card conversion, private permissions and audited bank-write rollback. `check-wire-email.mjs` covers escaped content, configured bank data, immutable retries, stale payment requests and address mapping.

Local intercepted browser checks cover explicit unchecked consent, server-conflict recovery retaining input, exact acceptance payload, automatic receipt/instructions, phone preservation and 1440/390px layouts; no uncaught page errors. Authenticated browser checks use synthetic identities and intercepted APIs. No real payment, SMS, customer email or order was generated for these tests.

Observed live before release: bank destination and SWIFT configured; sender enabled; zero unresolved email jobs; all 16 unique public product image URLs returned nonempty images. These configuration checks do not certify the bank details or actual inbox delivery.

## Release verification

The combined release passed 182 automated tests, product-search checks and a production build. Production dependency audit reported zero known vulnerabilities. Browser fixtures cover the redesigned support receipt, threads and reply/reopen flow, storefront/admin error recovery, mobile layout, wire agreement and card-to-wire conversion. The two additive migrations are applied; the new RPCs deny anonymous/customer execution and allow only service-role execution. Both private ledgers have RLS and deny customer/anonymous reads. Migration filenames match the production history.

## Launch work still required

Tax is intentionally deferred at the owner's request. The site is not cleared for public launch until applicable tax handling is completed. Other gates remain: native Supabase password-update bypass of custom recovery SMS; isolated real Stripe decline/3DS/refund/expiry acceptance tests; owner-controlled email/SMS/inbox journey; tested backups and restore; insured bullion fulfillment/inventory confirmation; legal review and confirmation of the bank's wire-specific ABA/SWIFT details. Crypto remains disabled; concurrent invoice creation needs hardening before enablement. Manual capture stays disabled pending acceptance testing. No paid plan was activated.

## Recovery

Retain consent, payment request and email ledgers for evidence. Do not remove rows or restore over production. Roll back application code only with compatible migrations retained, and disable new wire ordering if required rather than erase accepted obligations. Before rolling back the email worker, stop claiming new wire email events; the old renderer does not support that event. Keep existing reconciliation for in-flight card requests. No bank credentials belong in git, browser bundles, reports or logs.
