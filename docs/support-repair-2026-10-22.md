# Support tickets and customer notifications

## Problems found

Customer ticket creation used a direct insert without an INSERT grant. Admin replies inserted a message and then changed status in separate operations, ignoring update errors. There was no standalone status action. Conversation read errors were hidden, drafts/status could become stale, and all admin sections attempted to load support data. Neither ticket creation nor replies sent customer email. Broad legacy message grants also included TRUNCATE, which RLS does not protect.

## Changes

- Dedicated Support admin panel: latest activity, search of loaded tickets, status filters, pagination, expandable conversations, visible/retryable loading errors, independent status saving, draft preservation, and current-state conflict checks.
- Ticket creation, replies, closing, reopening and admin status changes use one server-verified operation. Auth/session/SMS checks remain mandatory for customers, authenticator MFA for admins. Actor/role cannot be supplied by the browser. Order references must belong to the account.
- Message, status, audit and notification changes commit together. Request IDs deduplicate ambiguous retries; stale admin updates return a safe conflict. Customer replies reopen answered/closed conversations.
- Anonymous support grants and customer write/TRUNCATE grants revoked. Existing owner/admin read RLS remains; only the service operation can write. No existing tickets/messages deleted or rewritten.
- Ticket-created, staff-reply and status-update notifications reuse the durable branded email queue. Messages go to the owner's verified email. Private conversation text stays inside the signed-in site. Email links open the specific ticket and preserve that destination through sign-in. A staff reply and its status change produce one notification rather than two.
- Admin → Security → Customer email updates now controls both order and support email, with samples for all templates and delivery activity.

## Validation

13 support database/Edge-handler tests cover atomic rollback, identity/ownership, admin MFA, SMS/session enforcement, stale changes, request replay, separate status updates, create/reply/reopen, email enqueueing, private email contents and revoked destructive privileges. Existing 79 signup/security/order-email tests passed. Build and browser fixtures passed: admin standalone status update, message-load failure/retry, retained draft after conflict, customer ticket creation/replies/reopen, deep-linked conversations, desktop/mobile, all support email layouts at 600/390/320px. No real customer tickets were modified or test emails sent.

Production schema grants verified; existing ticket count preserved. `support-operations` v7 and `order-email-worker` v2 deployed. Email activation remains a manual sender connection in Admin → Security; Resend inbox delivery/bounces must be checked there after sending an admin sample. Shipping remains temporarily $0 at the owner's request.

## Recovery

Pause customer email updates to stop enqueueing/sending. Retain ticket and outbox histories. Do not restore broad legacy grants or bypass server verification as a rollback. The additive schema can remain installed if rolling back presentation code.

## Customer submission follow-up

Submission feedback previously appeared only in the history section below the form, and successful submission awaited additional reads. Short inputs could also be stopped by browser validation without a persistent explanation beside the button. The form now validates trimmed values with visible, accessible errors, shows saving progress, retains failed drafts and request IDs, and bounds support requests to 25 seconds. Server validation and authorization are unchanged.

A committed server response immediately shows a focused **Ticket received** receipt with reference, subject, status and **Track this ticket** link. Slow or stale history reads cannot overwrite the receipt. The link reopens the private conversation after reload/sign-in; refresh updates both ticket status and messages. Email copy distinguishes a queued confirmation from unavailable delivery. No emails are claimed sent when the sender is disconnected.

Email settings reads and sending operations now use separate rate-limit counters: six refreshes no longer prevent connecting the sender, while the sixth send in ten minutes is still rejected.

Validation: all 93 automated tests, product search checks and production build passed. Browser fixtures passed inline validation, visible submission errors, retained draft/request ID on retry, focused receipt, tracking after reload, admin status/replies and mobile layouts. Live read-only checks passed homepage/product images, product page, cart add/reload, mobile width and signed-out admin redirect without console errors. Production dependency audit reported zero known vulnerabilities. No real customer tickets, orders or emails were changed by tests. Sender activation and actual inbox delivery remain unverified until the owner connects a Resend sending key in Admin → Security → Customer email updates.
