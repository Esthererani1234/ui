# Customer experience and security fixes — 22 October 2026

## Homepage photo (PR 38)

The original Buffalo photo was a 2,069,617-byte PNG requested only after the
catalog loaded. Faithful local WebP copies are 37,386 and 122,062 bytes. Initial
HTML preloads the responsive photo; the same image element stays mounted while
live catalog details arrive. No stock or pricing is seeded. A changed featured
product uses its own image, and a failed optimized image falls back to the original.

Production HTML and both image URLs returned 200 with the intended cache headers.
Cold browser checks at desktop, tablet DPR2, and mobile DPR3 decoded the photo
before a deliberately delayed catalog response, with one shared preload request
and unchanged photo bounds. Catalog and image failure paths were also checked.

## Unique verified phone enrollment (PR 39)

SMS checks now reject a phone belonging to another account before a paid send.
A private database claim with a unique normalized phone key also guards completion,
so stale availability checks and simultaneous verification cannot bypass ownership.
Claims are made only after verification, not by abandoned registrations. Existing
owners retain sign-in and recovery; a verified replacement releases their old claim.
The UI explains the conflict and allows another number without restarting email
verification. No other account's email or identity is returned.

The production migration found three previously verified accounts sharing one
number. Their access was preserved explicitly; additional accounts cannot join
that number. The business should review those existing accounts before deciding
whether any should be consolidated or closed. No accounts were deleted or merged.

Migrations: `20261022145500_unique_customer_phone_enrollment.sql` and
`20261022153500_atomic_phone_claim_reservation.sql`. The latter combines claim
reservation and ownership lookup into one locked statement, including a race
with account deletion.
Deployed `customer-sms` v7 with JWT verification enabled.

## Risk review reliability

Previously, validation/server errors were behind the open dialog, repeated clicks
could submit concurrently, successful messages disappeared on refresh, and an
update could report success without updating a review. The decision and audit
insertion were separate operations.

The dialog now shows errors, retains notes for retry, blocks duplicate submissions,
and confirms saved decisions. Queue refresh, filters, and explicit empty/error
states make results visible. Expected decision/timestamp checks prevent stale tabs
from overwriting newer reviews. The server validates the payload and commits a
locked review update and audit record in one transaction. Missing reviews fail.
Admin authorization, active session checks, AAL2, and rate limits remain enforced.

Approval clears only the risk hold; it never marks payment received. Rejection
holds fulfillment and does not automatically cancel or refund an order. Closed or
already fulfilled orders cannot be retroactively rejected through this operation.
Anonymous table access and browser write/truncate privileges were removed;
admin-only RLS reads remain.

Migration: `20261022151000_atomic_admin_risk_decisions.sql`.
Deployed `admin-operations` v11 with JWT verification enabled.

## Post-checkout order details

The existing authenticated return URL now opens a dedicated order confirmation
instead of placing a small message above the account dashboard. It includes item
photos, names, metal/type/weight, SKU, quantity, unit and line prices, authoritative
totals, payment status, delivery address, contact details, customer notes, tracking,
progress, secure wire instructions, support, refresh, and printing. Order history
also gains photos and a full-order link.

Payment headings come only from owner-scoped database records. URL parameters
cannot mark an order paid. Unknown/inaccessible orders show no receipt. Network
failures during payment polling are handled, and older responses cannot overwrite
a newer order record. Existing RLS and SMS access requirements are unchanged.

New order items capture presentation fields from the trusted product row, preserving
their photo URL/type if the catalog changes. Existing items use a public catalog
photo fallback, or a neutral placeholder if the image is unavailable. These fields
do not alter pricing, inventory, checkout calculations, or existing financial data.

Migration: `20261022152500_order_item_photo_snapshots.sql`.

## Verification and limits

- Full `npm run check`: product search, 9 signup tests, 52 security/API/database/
  SMS-handler tests, and production build passed.
- Database tests cover phone ownership, duplicate/stale enrollment, OTP replay,
  preserved legacy owners, risk authorization, stale decisions, atomic audit failure,
  paid/unpaid fulfillment guards, and trusted item-photo snapshots.
- Browser fixtures cover mobile duplicate-phone error → change number → verify →
  home; paid and pending receipts; forged return URLs; inaccessible orders; wire
  instructions; visible risk validation, stale-save retry, approve/reject, filters,
  and mobile layout. No uncaught browser errors were observed in these checks.
- Production schema/permissions and deployed asset checks supplement the fixtures.
- No real customer SMS/email was sent and no real payment, risk decision, order
  status, tracking detail, or refund was changed for testing. This is not a claim
  of a real end-to-end card charge, carrier delivery, or complete production audit.

All migrations are additive or permission-restricting. No production customer or
financial records were deleted or reset. Earlier open audit findings remain in
`production-audit-2026-10-15.md` and are not superseded by this work.
