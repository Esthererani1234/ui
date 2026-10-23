# Account Selling Centre

This replaces the guest submission flow documented in `sell-portal-2026-10-22.md`.

- `/sell` remains the public introduction. Get a quote opens `/selling-centre`, requiring sign-in and the existing customer SMS verification. Login/signup preserve the return destination.
- Account navigation now includes Selling Centre, with a new-case form, saved case list, current status, item description, last update, refresh, and pagination. The account email is prefilled and read-only; the server derives it from the verified user.
- Creating a case requires a confirmed email, live session, SMS verification (or administrator AAL2), existing spam controls, and an additional three-cases-per-account hourly limit.
- Server assigns `user_id` from verified authentication. Customers cannot submit an owner ID or select another account. Customer list queries explicitly filter owner and exclude internal notes and request IDs. Direct Data API access remains revoked.
- Requests are keyed to their owner for replay checks. The retired guest database function can no longer be executed by the service role.
- Existing guest enquiries are preserved for admins, with no automatic email-based ownership reassignment. Deleted accounts leave the enquiry intact for admin review.
- Existing admin statuses, notes, audit trail and email/phone contact links continue to work. Automated selling emails and a customer/admin message thread are not included.

Verification: account creation/mine access rejects missing login or SMS verification; spoofed owner fields rejected; customer queries filtered by verified identity with private fields excluded; cross-owner request replay rejected; admin controls remain protected. Browser fixtures cover login routing, prefilled account email, failure/retry, saved cases after reload, admin conflicts, and widths 1440/1024/768/390/320 without overflow or page errors. No real customer cases or outbound messages were created during browser tests.
