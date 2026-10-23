# Dedicated Sell to us portal

## Delivered

- `/sell` (and `/sell-to-us` redirect), with a compact navigation item beside the four metals, plus a footer link.
- Gold, silver, platinum and palladium; coins, bullion, jewelry, broken pieces and scrap for evaluation and potential melting/refining. No unsupported exclusivity, guaranteed offer, turnaround, or payout claims.
- Guest quote form: name, email, phone, description. Accessible focused receipt with a unique reference, preserved drafts on failure, stable retry IDs, no account requirement.
- Separate Admin → Sell requests inbox (`/admin?tab=sell`), search, status filter, pagination, email/phone links, internal notes, and New/In review/Contacted/Quoted/Closed statuses.
- Public references are receipt identifiers, not authentication tokens. There is no public request lookup exposing contact details.
- This release does not send automated sell-request emails or SMS. Staff follow up using email/phone links; internal notes are explicitly not sent. Existing support/order email systems are unchanged.

## Protection and persistence

- Additive migration `20261023005534_sell_requests_portal.sql`; existing business tables/data are preserved.
- RLS enabled on `public.sell_requests`, with anon/authenticated table and RPC privileges revoked. Only service-role server operations can access it.
- New `sell-requests` Edge Function has gateway JWT checking disabled to allow the public guest form. Every list/update action independently validates the token with Auth, current admin membership, AAL2, and a live session before accessing data.
- Strict field allowlists, bounded JSON body, field/email/phone validation, honeypot, persistent hourly submission limits: 10/IP, 3/email, 100/global. Admin actions: 60/10 minutes.
- IP/email values are hashed before rate-limit storage. Forwarded IP is defense-in-depth; email and global limits do not depend on caller-supplied IP headers.
- Create retries use a unique request ID and must match the original content. Public response contains only reference/received time, never submitted personal details or notes.
- Admin saves use optimistic version checks and an atomic audit entry without note/contact content. An identical retry is a no-op.
- No browser secrets, new dependencies, payment changes, or authentication architecture changes.

## Verification

- Full `npm run check` passes: 189 automated tests plus product-search checks and production build.
- Seven new API/database tests: private reads/RPCs denied; deduplication and changed replay rejection; atomic audit/stale save handling; input validation; rate limiting; origin restrictions; admin membership/AAL2/live-session requirements.
- Mocked browser story: guest form → failed response → retry → focused receipt; admin inbox → conflict → retained draft → refresh → successful save.
- Browser widths 1440, 1024, 768, 390 and 320: no horizontal overflow or page exceptions; desktop/mobile screenshots inspected.
- Live schema grant verification and invalid/unauthenticated endpoint smoke checks. No real seller leads, emails, SMS, orders or payments created by browser tests.
- Security advisor: no ERROR findings; new table's no-policy informational notice is intentional because it is server-only. Existing pg_net-schema and leaked-password-protection warnings are unchanged.

## Operational notes

Check the Sell requests inbox regularly; there are no automated staff alerts in this release. Contact sellers to discuss inspection and logistics before accepting shipments. A quote request is not a sale contract or a price lock. Reverse a frontend release by restoring the previous frontend deployment; leave the additive table intact to preserve submitted enquiries.
