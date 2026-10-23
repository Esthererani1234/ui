# Navigation, market timestamp, and purchase policies

## Changes

- Grouped metal categories, highlighted Sell to us, product formats, and assistance links. Metals and Sell to us remain visible on mobile; other links use the accessible expanded menu. Escape closes it and restores focus. Shop category highlighting now includes the query filter.
- Market feed timestamp shows the actual returned date and time in America/New_York, US 12-hour format, with daylight-aware EDT/EST. Missing/invalid timestamps are omitted; failed refreshes retain the original timestamp with the last-price notice.
- Expanded Privacy Policy and Terms of Purchase with actual providers and processing, first-party analytics, assistant processing, retention criteria, privacy requests, adult eligibility, order acceptance, pricing, refunds, shipping delays, and separate evaluation/melting authorization for selling cases.
- Added browser-local analytics opt-out and honored GPC in addition to DNT; queue flush rechecks preferences. Essential functionality continues.
- Added conspicuous refund/shipping links before checkout contact/payment fields and footer links. Checkout policy links open separately to preserve the order form. Policy pages have contents, stable section links, and print styling.
- Archived original terms at `/terms?version=2026-10-22`. Revised checkout sends `2026-10-22-v2`; server/DB accept both published versions for existing clients and record the exact supplied version. Replays do not rewrite acceptance.
- Wire agreement text, deadline, actual-loss formula, and immutable snapshot are unchanged. Corrected card-to-wire conversion to preserve original general terms acceptance metadata instead of overwriting it. No historical orders were backfilled or changed.
- Aligned assistant payment/refund guidance and removed misleading “private session” wording.

## Verification

- Local full check: 193 automated tests (9 signup, 126 security, 36 emails, 22 support/sell), product search checks, and production build passed.
- Browser fixtures: widths 1440, 1280, 1100, 1050, 1024, 768, 390, 320; no horizontal document overflow. Mobile menu, Escape/focus, category navigation and active state, Eastern date rollover/12-hour timestamp, policy section navigation, archived terms, persisted analytics opt-out, and GPC suppression passed without page errors.
- Real SQL via PGlite verifies new terms for card/wire, preservation through conversion/replay, old-client compatibility, rejection of unknown versions, atomic wire consent, and existing authorization/inventory/payment guards.
- Browser tests use fixtures, not real payments or customer messages.

## Business/legal review still required

These are tailored operational policies, not an attorney's enforceability opinion or a complete legal/compliance audit. Have New York counsel review contract acceptance, actual-loss recovery, state-specific consumer rights, electronic contracting, refund operations, and precious-metal purchasing/refining requirements. Do not automatically charge claimed market losses. No new mandatory arbitration or class-action waiver was added.

Confirm a public business correspondence address and company contact details before adding them; none were invented. Operational retention schedules, carrier/insurance limits, and actual shipment promises must match practice. Identity/AML, tax collection, and state/local secondhand-dealer or refinery rules need separate professional review. A selling case is not permission to melt property; a separate signed evaluation/refining agreement is required before destructive work. Policies cannot fix incomplete tax configuration.

## Sources reviewed

- NY UCC 2-718: https://www.nysenate.gov/legislation/laws/UCC/2-718
- NY General Business Law 218-a: https://www.nysenate.gov/legislation/laws/GBS/218-A
- FTC prompt-delivery guidance: https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule
- NY Attorney General privacy-controls guidance: https://ag.ny.gov/resources/organizations/business-guidance/website-privacy-controls

## Rollback

The function changes accept the old frontend's version and retain service-only privileges. Roll back frontend first if necessary; keep all order/acceptance records. Reverting the function definitions must not reset production data or replace historical agreements.
