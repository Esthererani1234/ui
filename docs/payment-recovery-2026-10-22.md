# Payment recovery guards — 22 October 2026

This report describes the reviewed payment recovery changes. The additive migration was applied to production on 22 October 2026. Stripe configuration, provider keys, capture-mode settings and crypto settings are unchanged. All provider calls in the regression tests are fixtures.

## Changes

- New service-only `claim_card_payment_request` records the order, confirmation-token hash and exact amount before contacting Stripe. The server includes that hash as `payment_claim` metadata on the intent. Raw confirmation tokens and client secrets are not stored in the recovery ledger. The existing claim RPC remains available for old deployments during rollout.
- `bind_card_payment_intent` locks the order and request, verifies the owner, claim, cents and unique intent mapping, then commits the attempt and order binding together. A new attempt starts pending even when the previous attempt failed. Replayed bindings cannot reopen a terminal attempt or replace a newer request. A delayed callback for an earlier decline cannot release the newer claim.
- Card confirmation no longer suppresses persistence errors after Stripe reports success. Definitive declines are retrieved from Stripe and recorded before releasing their claims. Uncertain provider or database errors retain the claim.
- Stripe webhooks can recover a new unbound intent using canonical provider data plus the durable request. They retain signature, USD currency, exact amount, owner, order and received-amount validation. Authorization-ready events also use the existing guarded capture path; this does not enable manual capture.
- The leased worker includes unresolved claims. It searches by the exact order and claim hash, then retrieves the unique intent canonically before binding. Empty/eventually-consistent results, multiple matches, provider errors and mismatches leave the claim intact. The worker never creates or confirms a replacement intent.
- A common payment trigger resets a previous approval to pending when settlement arrives after its deadline or cancellation. Existing rejection remains rejected. It creates a missing risk review, changes its concurrency timestamp, and records `payment.late_review_required` in the audit log in the same transaction. Fulfillment requires a fresh audited approval through the existing admin review operation. Duplicate payment delivery does not reset an already-reviewed payment again.
- Wire settlement uses `payment_due_at`, including the manual admin paid operation. Other payment methods use `price_locked_until`. An expired spot quote alone does not classify an otherwise timely wire as late. No wire agreement/deadline migration was edited.

## Migration and files

Created with `npx --no-install supabase migration new payment_recovery_guards`:

`supabase/migrations/20261022214410_payment_recovery_guards.sql`

Server changes are `server/payments/confirm-card.js`, `server/payments/stripe-webhook.js`, new `server/lib/cardRecovery.js`, and `api/operations/reconcile-payments.js`. Existing `cardCapture.js` settlement/capture validation is reused. Shared payment helpers, crypto checkout and wire handlers were not edited by this task.

## Verification

Completed locally: 17 new regression checks passed; 30 checks passed with the existing capture and launch API suites; the full `node --test scripts/check-*.mjs` run passed 183 checks. Scoped `git diff --check` passed. The full run included the concurrent wire suites as present at test time; their implementation remains owned by root.

Run the new regression suites:

```sh
node --test scripts/check-payment-recovery*.mjs
```

Run them with existing capture, signature/router and worker-authorization checks:

```sh
node --test scripts/check-payment-recovery*.mjs scripts/check-card-capture.mjs scripts/check-launch-api.mjs
```

The database suite applies actual migration definitions to an in-memory PostgreSQL fixture. It covers atomic rollback/recovery, failed-to-new-pending transition, capture eligibility, worker leases, stale callbacks, late-review reset and audit rollback, fresh approval before shipment, timely/late wire deadlines, and denied client RPC/table access. Provider fixtures cover search lag/no result without creation, ambiguous and legacy claims, canonical re-fetch, USD/amount/owner/claim mismatches, incomplete settlement, signed-webhook recovery, and confirmation recording failure.

## Release and remaining risks

1. The additive migration must precede the matching server deployment; production migration is applied. It does not backfill or alter historical orders. Production had zero unresolved card claims or pending card orders at the pre-release check.
2. Keep `card_manual_capture_enabled=false` until isolated Stripe acceptance tests cover normal payment, decline/retry, 3DS, late completion, lost response, duplicate callbacks, refunds and capture uncertainty. This patch does not solve the separate native Auth recovery gap or crypto invoice concurrency issue.
3. Pre-existing unresolved claims without a recovery-ledger row/metadata remain manual-reconciliation cases. Never manufacture metadata, delete a claim, or create another intent merely because search returns nothing. Provider Search availability and eventual consistency affect recovery time; failures are surfaced through existing reconciliation-error reporting.
4. No historical late settlements are retroactively put on hold. Review existing late-paid orders separately before fulfillment. A previously rejected risk decision is preserved.
5. Late classification uses database receipt/confirmation time rather than an untrusted client timestamp. Delayed provider delivery can conservatively require review of an otherwise timely payment.
6. Regression tests use fixtures and do not establish live Stripe/SMS/email acceptance or multi-connection load behavior. Tests do not change provider configuration.
7. On rollback, retain the recovery ledger and claims as financial evidence. Stop new card confirmations before reverting recovery-aware server code; continue reconciliation or use an explicitly reviewed manual procedure for requests already recorded by the new flow. Do not drop ledgers or clear claims to unblock checkout.

Both new scripts are included in `package.json` → `check:security`, preserving root's wire test entries. They therefore run through `npm run check:security` and the existing `npm run check` pipeline.
