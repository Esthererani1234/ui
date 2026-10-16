# Admin order controls repair — 2026-10-16

The order window previously displayed save errors behind the modal and sent all payment/status fields even when the administrator only edited tracking. A paid awaiting-payment order also required an unclear sequence of intermediate status edits before shipping.

Changes:
- Show failures within the order window and preserve edits for retry.
- Send only changed fields; omitted fields retain their current database values under a row lock. Tracking-only edits cannot overwrite a newer payment status.
- Show payment and risk prerequisites and disable unavailable status choices. Link to Risk center when approval is required.
- Permit one audited shipment action for paid, approved orders in pre-fulfillment states. The transaction records processing before shipped; both updates enforce payment and risk guards.
- Preserve cancellation/restocking safety, block backward fulfillment transitions, and avoid repeating wire-payment audit events when adding tracking.
- Validate admin update fields server-side; maintain active-session/AAL2/admin membership checks and service-only RPC grants.

Verification: 44 automated tests pass (9 signup and 35 API/database), search checks and production build pass. New database cases cover partial edits, one-time restocking, paid shipment, payment/risk rejection, backward transitions and wire audit behavior. Browser fixture checks cover tracking payload, modal error visibility, retry, cancellation and mobile shipment. Admin Edge source type check and deployed bundling pass. No production orders were mutated for verification.

This fixes the editing workflow; it does not authorize unpaid shipment or replace the unresolved payment-provider/recovery work documented in the broader production audit. Cancellation does not automatically refund a payment.
