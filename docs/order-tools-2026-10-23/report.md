# Order tools and private case images — 2026-10-23

New orders use a sequence-generated G-100001-style number. New wire references equal the order number; historical numbers and issued bank references are preserved. Four database functions receive narrow expression replacements, retaining their pricing, authorization, idempotency, stock and consent logic.

Customer order receipts offer a server-generated PDF invoice. The endpoint authenticates the session and SMS verification, checks ownership and rate limits downloads (30/10 minutes). It uses stored order/item amounts and current payment/order statuses, never client-supplied totals. Unpaid invoices are explicitly not proof of payment. No bank numbers are embedded. Tax treatment is unchanged.

Support tickets and selling conversations offer an accessible + Attach image control, preview and remove actions. JPEG, PNG and WebP only; client input <=10 MB is resized to 1200 px and re-encoded without camera metadata, with a 1 MB stored limit. Six photos per case. Support photos are in a separate private bucket and service-only RLS table. Owner/admin checks precede signed links (5 minutes); customers need SMS verification, admins need AAL2. Database row locks enforce photo limits and deduplication. Uploads are limited to 12/hour. Administrators can read/upload through their support panel. Create the ticket/case before attaching photographs.

Validation:
- Full npm check: 223 tests passed (9 signup, 130 security, 46 email, 38 support), search checks and production build passed.
- Local browser fixtures at 390 px and 1440 px: invoice download filename, + file chooser, SVG rejection, supported image preview, support upload and selling upload passed. Provider/database operations mocked, no real customer messages/orders created.
- PDF parsed, multi-page overflow tested; fixture rendered and inspected. Text extraction confirmed totals/status and address. Standard PDF fonts used.
- npm audit --omit=dev: zero reported vulnerabilities.
- Database tests include unauthorized access, changed replay, six-photo limit, private bucket, rate limiting and new order number uniqueness.

Rollback: revert frontend/API commit and remove the new Edge endpoint from service if needed; retain customer records/images and sequence. Restore the four prior number/reference function definitions to restore old numbering without changing issued numbers.

Limits: authenticated production invoice and photo upload need a real customer/admin session for live acceptance testing. Historical references are deliberately unchanged. Existing Node hosting patch issue and other launch-readiness/legal/tax tasks are outside this change.
