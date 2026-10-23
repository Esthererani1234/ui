# Wire instructions and transactional email repair

## Findings and fixes

- Wire instructions auto-opened after checkout, but the button retained “View” and fetched the same content. It now toggles “Hide” / “View”, exposes its expanded state accessibly, revalidates on reopening, reports missing sessions, and times out stalled reads.
- A production wire email failed with `wire_instructions_unavailable` because the bank address was blank. The website allows this optional field; the email renderer incorrectly required it. Beneficiary, bank, routing, account, total, reference and deadline remain required. Optional addresses are omitted, never invented.
- Wire instructions now also acknowledge receipt and thank the customer. They do not claim payment has arrived.
- The affected order was cancelled during investigation. Its never-prepared wire message was safely skipped; its cancellation message was subsequently accepted by Resend. Provider acceptance does not establish inbox delivery.
- Added private queued notifications after SMS-verified sign-in/signup, actual password changes, and actual email-address changes. Email changes notify the previous verified address and the verified replacement. Token refreshes and repeated SMS completion for the same session do not create duplicate sign-in messages. No hashes, passwords, OTPs, IPs or tokens are copied into notifications.
- Account alerts reuse durable messages, provider idempotency, leases and retry limits. Queue failures do not block authentication and emit a fixed diagnostic. Existing order-emails enable setting controls delivery; native Supabase reset/verification emails are not replaced.
- Admin email previews include account security. Fixed support-preview labels previously truncated to their first character.

## Verification

- Full check before the final admin-preview adjustment: 213 tests passed (9 signup, 126 security, 46 email, 32 support/selling/market), search checks and production build passed.
- Browser fixture using the real PaymentAction component: 390px and 1440px automatic opening, hide, fresh reopening, API error display and retry passed. Fixture API calls and session were simulated; no real payment was created.
- Live worker upgraded; schema triggers enabled. Anonymous and authenticated users cannot read the outbox or execute its security-definer trigger.
- Live cancellation provider acceptance verified, obsolete wire skipped. New security-event generation/rendering tested locally; no customer password/email was changed to test delivery.
- Existing cancellation, refund, paid, processing, shipped, delivered and tracking events have automated coverage, including duplicate events and immutable retries.
- Security advisors unchanged: intentionally service-only RLS tables, existing pg_net public-schema warning and leaked-password protection warning.

## Limits and rollback

- Reset-request and signup-code SMTP delivery were not independently tested against a real mailbox in this change. New account alerts confirm completed changes; they are not reset links or verification codes.
- Inbox placement/spam filtering is not proven by provider acceptance.
- No historical notifications are backfilled. Pending messages follow existing stale/superseded-message rules.
- Roll back storefront with the previous Vercel deployment. Disable the two new account triggers before reverting the worker to a version without account-template support; retain notification records. No customer/order data was deleted.
- The previously identified Vercel Node patch issue remains a separate unresolved hosting issue. This repair does not claim to resolve it or deploy the blocked Node PR.
