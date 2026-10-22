# Configurable payment maximums

Admin → Store settings → Payment order maximums exposes separate USD maximums for card, wire, and crypto. Initial values are $10,000, $100,000, and $2,000,000. Supported inputs are $1–$10,000,000 with at most two decimals. Saving does not activate any payment provider.

The maximum applies to the server-calculated final order total, including shipping and payment fees. Checkout displays the current settings and gives an early validation message. The database rejects over-limit order inserts, changes of payment method, and repricing across both quote-based and legacy checkout. Lowering a maximum does not cancel or mutate existing orders; payment/fulfillment updates remain possible. Any future tax integration must include tax in the authoritative total checked here. Tax collection is not implemented by this change.

Edits require the existing live-session, administrator-membership and AAL2 checks, with the existing admin rate limit. A service-only RPC validates all fields and atomically saves all three settings with before/after values, actor, reason and timestamp in the audit trail. Public settings contain only the non-secret limits. Existing RLS is preserved.

Validation: 133 automated tests and production build passed. New tests cover all three exact boundaries, one cent over, changed limits after quoting, stock/quote rollback, legacy checkout, method changes, repricing, retained existing orders, invalid values, atomic auditing, customer denial, AAL1 denial and expired-session denial. Browser fixtures verify mobile/desktop fields, save/reload, failure retaining drafts, and invalid-value feedback. No real charge, SMS, or customer email was created.

Rollback: revert the application commit and drop the new order trigger and settings RPC if needed; keep settings and audit records. Never reset data.
