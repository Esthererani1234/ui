# Customer account and support navigation — 22 October 2026

## Experience

The account and support pages share four direct navigation links: Orders, Profile, Security, and Support tickets. Customer details and the default delivery address are grouped separately from sign-in contact details. Name/address saves do not write the verified phone. Phone-change requests open the existing private support flow.

Existing account support URLs remain usable, and recent-ticket cards open their specific conversations. A receipt's “Get help with this order” link opens the new-request form with its order reference filled in. Category/order query parameters only prefill the form; they never submit a request or authorize access. Existing server ownership checks remain unchanged.

The expanded support conversation is derived from the URL. This fixes a verified rapid-navigation/Back-button race in which the URL changed but a different conversation stayed open. Deep links focus the actual ticket, new-request links focus the subject, and navigating to a new request preserves a draft. Successful support-history refreshes clear stale load errors.

Profile saves retain edits on failure, block duplicate submits and show a confirmed result. Orders and ticket lists have independent loading, errors and retry controls. Responses belonging to a previously signed-in account do not update the current account form. The phone is managed separately from ordinary profile saves. The existing password-reset provider and verification flow are preserved.

Header account/cart icons have accessible names on mobile, and the header now fits a 320px viewport. Customer-account and support styles are scoped; order receipts, payment totals, wire consent/deadlines, provider settings, email delivery and admin functionality are preserved.

## Verification and limits

Intercepted browser checks use synthetic sessions and local data, never real customer mutations. Support checks passed at 1440/768/390/320px, including contextual request prefills, form focus, retained drafts, direct ticket URLs, browser Back, private-account changes, failed-message retry, and blocked replies before a successful conversation read. No uncaught page errors or horizontal overflow were found at those widths.

Account browser checks passed at 1440/390/320px: profile validation, preserving dirty drafts during background refresh, failed/zero-row save handling, retry and busy controls, phone exclusion, independent order/support failures, stale responses after account changes, missing-profile retry, password-reset error/retry, and successful sign-out to the homepage. The original support create/reply/reopen/receipt suite and wire checkout/receipt browser suite also passed after the account changes.

No database migration, provider change, production email, SMS, payment or test order is part of this account/navigation follow-up. Existing launch gates in `wire-checkout-review-2026-10-22.md` still apply; this UI improvement is not a launch-security certification.
