# Operational procedures and integration plan — not active

Version2026-10-23-draft.1. These are proposed staff procedures and engineering acceptance criteria, not a representation that they are deployed. Read with RESEARCH.md and the16draft policies.

## Verified architecture and data map

The application is **React/Vite with Vercel APIs and Supabase**, not Next.js. Do not rewrite its architecture to match the prompt's label.

| Data / purpose | Observed source / recipient | Required control / unresolved question |
|---|---|---|
| Account email/password/session | Supabase Auth; `src/state/AuthContext.jsx`, `src/pages/AuthPage.jsx` | Passwords never staff-visible. Browser session storage remains; native recovery/SMS issue from prior audit remains. |
| Phone / SMS verification | Bird/MessageBird through server/Edge workflow | OTP expiry, attempts and durable limits retained. Verify real delivery and STOP/HELP behavior; no marketing implied. |
| Orders, addresses, payment references | Supabase orders; Vercel payment routes | Owner checks and trusted service access; do not expose full records to analytics/assistant. |
| Card entry and events | Stripe payment components and server handlers | No full card details in general forms/logs; verify account-specific rules, amount/currency and webhook provenance. |
| Transaction and support emails | Resend; shared email templates/outbox | Verify delivery logs, bounce handling, retry and deduplication; acceptance must get its own event. |
| Support tickets and selling case messages/photos | Supabase private records and selling-case storage | Owner/admin access; signed URLs; internal notes separated; no ID documents in general uploads. |
| First-party analytics | `src/lib/analytics.js`, `api/analytics/track.js` | Browser visitor/session IDs; server hashes identifiers, stores paths, referrer host, approximate geography and allowed metadata. Hashing is pseudonymization, not anonymization. GPC/DNT/browser opt-out observed in code. |
| Optional UI assistant | `SupportAssistant.jsx` invokes `store-assistant`; Cloudflare model | Messages and recent context; no customer order access in this active path. Do not send secrets/ID. |
| Separate unused assistant route | `api/assistant.js` contains OpenAI and authenticated-order context support; read-only production GET returned `configured:false` | Not the UI's active provider. Before enabling, update privacy disclosure and inspect SMS/authorization and order-context minimization. Do not claim Cloudflare is the only possible provider in all future configurations. |
| Market data | `server/lib/quotes.js` uses Gold API and0.4% dealer adjustment | Reference is retail-adjusted, not untouched raw market spot. Disclose product/price composition accurately; raw reference for tax/damages must match legal measure. |
| Hosting/request logs | Vercel and Supabase | Verify log retention, redaction, incident alerts, regional processing and vendor terms. |
| Carrier/insurance/verification documents | Business processes not fully inventoried | Owner must supply actual vendors, policy coverage, access method and retention; drafts make no invented claim. |

## Proposed support intake and case types

Create a case reference immediately on successful durable submission, acknowledge in the UI, queue a transactional receipt exactly once and make the case accessible to its owner. A button click alone is not a receipt. Messages should identify case/order without displaying other customers' information. Classify: order question; wire reconciliation; withdrawal/cancellation; shipping loss/damage; wrong/counterfeit merchandise; refund; fraud concern; default-loss dispute; privacy request. Keep selling inquiries separate. Staff internal notes must never become customer messages by default.

Assign an owner and deadline appropriate to legal/operational urgency. Ordinary acknowledgment target: one business day (proposed staffing goal, not a published guarantee). Payment deadlines, imminent shipping promises, suspected compromise and legal requests require urgent routing. Staff must distinguish receipt, investigation, acceptance, refund initiated and refund completed. Record material decisions, lawful basis and evidence, not speculative accusations.

## Acceptance and payment workflow

1. Server validates authenticated email/SMS session, cart availability/quantity, fresh market data, authoritative total and approved destination tax decision. Generate a10-minute quote with immutable fingerprint and method-specific amount. Unknown tax blocks a new offer; no arbitrary0% fallback.
2. Show full itemized amount, unchecked linked purchase assent, and wire acknowledgment with the actual deadline. If displayed deadline could change across an Eastern calendar boundary, re-consent before acceptance. Optional marketing is separate. E-SIGN delivery consent is separate where required.
3. In one database transaction: lock the quote, reject expired/used or wrong-owner quotes, validate approved active bundle and customer assent, create/retrieve one order per quote, insert exact bundle/quote consent evidence, append submission event and receipt outbox. Do not trust a client `user_id`, total, deadline, status, hash-to-content mapping or actor role.
4. Staff review within the open offer window. An authorized admin with strong session assurance may issue definitive acceptance only for a still-open, unwithdrawn offer. Lock order and quote in that same transaction. Rejection/withdrawal/expiry closes the offer without market-loss damages. A new offer requires new consent. Risk review approval is separate from acceptance.
5. Acceptance must atomically record its timestamp, immutable notice/body/version, total and payment deadline; create durable account notice and a deduplicated acceptance email. Publish to the account and record issuance under counsel-approved mechanics; handle email bounces. A reference-core `noticeId` alone is not a delivered notice.
6. Stripe adapter must validate signature on raw body, use trusted retrieved event/session references and expected amount/currency, and record provider event ID uniquely before applying state. Wire reconciliation requires authorized admin and actual verified bank receipt, not an image of a wire. Neither customer nor browser sets paid.
7. Keep contract, payment, fulfillment and risk statuses independent. Show refunds prominently even after delivery. Late payment on expired/rejected/canceled offers goes to reconciliation/refund review, not resurrection at an old price. Partial refunds use cumulative confirmed amounts; provider events cannot reduce recorded refund totals.
8. Fulfillment requires accepted contract, verified payment, no unresolved hold and viable shipping/insurance. Provider refunds, disputes or reversals must be reflected independently of delivery status.

### Integration file targets (not changed in this task)

- `src/pages/CheckoutPage.jsx`: approved bundle links, exact unchecked text, wire deadline acknowledgment, no prechecked consent, no silent substitution.
- `src/lib/legalPolicies.js`, `src/lib/legacyTerms.js`: preserve historical content; replace public version only after approval. New legal center routes/footer need link/accessibility testing.
- `server/lib/quotes.js` and quote/order SQL RPCs: retain freshness guard; add approved tax binding, no generic fee for unrecognized card funding type, server quote fingerprint and legal-version binding.
- `server/payments/*` and API router: authenticated adapters around the reference core; enforce owner/admin/provider provenance independently. Idempotency keys scoped to user+operation+quote; never trust event roles from payloads.
- `supabase/functions/_shared/wireAgreement.js`: approved successor version, deadline consistent with acceptance; preserve current historical text.
- `supabase/functions/_shared/orderEmail.js` and email outbox: distinct receipt, definitive acceptance, verified payment, delay-consent, refund and dispute messages. Exact acceptance archive and lawful notice timing.
- Order admin/risk UI: distinct Accept offer, Reject offer, Receive wire, Cancel after legal review, Ship and Refund controls with permission checks and durable audit. Do not silently map existing `approved` to legally accepted.
- Database: staged private bundle/consent/event store plus transactional production RPCs, privacy request/hold/suppression tables; existing orders must not be backfilled as if they signed new terms.

The supplied `contracts.mjs` is a tested pure reference core, not a network authorization boundary. `ledger.draft.sql` is a local evidence-store prototype, not complete production transactional RPCs. Real provider verification, row-lock atomic transitions, queue delivery, privileged actor resolution and authenticated archive retrieval remain integration work after decisions are approved. No security claim is based solely on a boolean passed by a browser.

## Wire operating procedure

Verify receiving account and beneficiary using controlled bank records; separate configuration from routine support. Require two authorized reviewers for bank-destination changes and log old/new version IDs without exposing numbers in general logs. Display only order-appropriate instructions to the authenticated owner/admin. SWIFT is included only when bank-approved instructions require it.

Maintain approved bank-operating calendar coverage; no inferred holiday or cutoff beyond it. Acceptance-day excluded, proposed deadline5PMEastern second bank business day. A stale/unknown calendar blocks acceptance. Record trace/reference, amount, payer and cleared time privately. For late/partial/third-party payments: reconcile first, contact customer, determine lawful extension/rejection/refund, do not demand a duplicate payment or ship based on advice. Verify source before returning excess; do not route refunds to an unrelated third party. Sanctions blocks require specialist handling.

## Default-loss worksheet and review

For each claim retain: accepted contract and exact terms; customer offer/assent; acceptance issuance; payment deadline/extension; actual breach evidence; seller ability to perform; relevant product/quantity; mitigation attempts and notices; resale date/place/quantity/gross proceeds; lawful alternative measure if needed; hedge transactions/offsets if relevant; actual incremental expenses; saved costs; payments/deposits; legal defenses; reviewer and customer correspondence.

Use one legally appropriate measure. Candidate resale worksheet: accepted affected merchandise amount minus qualifying resale proceeds plus recoverable incremental expenses minus avoided costs minus credits. Tax/shipping not incurred cannot be disguised as market loss. Do not mechanically apply this formula to unrelated pooled inventory or use cancel-day spot in place of the required legal reference. Counsel approves methodology and disputed/nonstandard claims. Staff issue an itemized proposed claim, offer review and reconcile held funds. No automatic default fee, account debit, card-on-file charge, collection referral or threat of litigation is implemented. Any collection referral must respect applicable consumer debt rules and dispute restrictions.

## Shipping and refund procedure

At ordering retain the legally applicable start time, promised ship-by date and reasonable basis (inventory/supplier capacity). Track remaining time independently of payment/risk status; review cannot conceal an approaching deadline. If dispatch promise cannot be met, send a lawful delay notice with revised date if supportable, response options, cancellation/refund mechanism and applicable consent requirement before deadline. Record actual choice and notice version. Do not treat silence as universal consent. Repeat or indefinite delay follows applicable FTC procedure.

Proposed notice skeleton: “We cannot ship order [reference] by [original date]. [Reason]. We propose shipping by [supported revised date]. You may cancel for the refund required by law using [simple channel]. [Counsel-approved consent language and response date].” Unknown revised date needs a separate approved notice, not a fictional estimate.

For claims: preserve packing records, weights, shipment/tracking and carrier evidence in private access-controlled systems, without publishing security details. Assign investigation owner. Distinguish delivered scan from verified correct delivery. Decide mandatory customer remedy independently of insurer reimbursement. Log refund request, approval, processor event, amount/tax adjustment and completed status; reconcile daily outstanding refunds. A preferred48-hour report request is not an automatic denial rule.

## Privacy/deletion operating procedure

States: received → identity verification → scoped assessment → in progress → completed/partially denied → appeal review → closed. Record request reference, relevant jurisdiction, due date, verification method/result, categories requested, legal basis for retained categories, reviewer, vendor tasks and notices. Do not collect ID by default or store password/OTP evidence. Use a signed-in step-up or proportionate alternate verification, including agents and lost-account cases.

Search by verified account identifiers across Auth, profiles, addresses, support, selling cases/photos, analytics where linkable, order archives and providers. Before deletion check unpaid/refund/dispute obligations, tax retention, fraud necessity and legal holds. Restrict retained records; delete/anonymize unnecessary data, revoke sessions and remove optional identifiers where appropriate. Record vendor requests and completion. Backups expire under a documented schedule and restored data must reapply deletion/suppression records. Never use a delete-auth-user shortcut that cascades away order evidence. Provide a category-level result and available appeal. Legal holds have owner, reason, scope and periodic review; they are not an indefinite blanket excuse.

### Proposed retention decisions — not implemented or legal minimum claims

| Category | Proposed review target | Required override/release check |
|---|---|---|
| Orders, tax, exact contracts and material payment records |7years after closure, subject to CPA/counsel confirmation | Tax limitation periods, AML/sanctions rules, disputes, holds; do not store full card credentials. |
| Security/verification event metadata |90days ordinary logs; longer documented incidents only | Separate applicable legal retention and proportionality; never retain plaintext OTPs. |
| Identity images if collected later |Delete promptly after verification unless specific justified retention; proposed30day review | Document actual purpose/law, vendor retention and pending investigation. |
| Support/selling inquiries without transactions |Review after24months inactivity | Linked transaction or dispute may require selected evidence longer. |
| Raw first-party analytics |Proposed90days, then aggregate/minimize | Confirm business need and remove identifiers; no job currently certified. |
| Marketing choices and suppression |Retain minimal evidence while required to honor choice and defend applicable claims | Do not erase suppression merely because marketing profile is deleted. |
| Backups |Owner must verify provider schedule and recovery process | Test restoration and reapply privacy deletions/holds; no backup guarantee claimed. |

## Marketing consent and suppression

No marketing enabled by this package. Proposed email checkbox: “Send me optional Gold On The Spot offers by email. I can unsubscribe at any time.” Separate proposed SMS checkbox, only after counsel/carrier approval: “I agree to receive recurring promotional texts from [verified entity] at the number provided, including automated messages. Consent is not a condition of purchase. Message frequency varies; message/data rates may apply. Reply STOP to opt out or HELP for assistance.” Verify the technical STOP/HELP mechanism before promising it. Link privacy and approved messaging terms.

Both start unchecked. Record channel, purpose, exact disclosure/version, destination, affirmative action and time. Do not treat general Terms, a security OTP, account creation or `marketing_opt_in` alone as sufficient campaign authorization. Suppression ledger must override all campaign audiences, imports and retries. Process unsubscribe/revocation promptly, respect applicable law, and keep minimal proof. Transactional messages must not be padded with ads that change their classification. Verify current FCC2026developments before activation; no blanket claim that opting out of marketing authorizes all other automated texts.

## Incident, AML and sanctions workflow

Name responsible compliance/security staff and counsel. On incident: contain access, preserve minimal evidence, log discovery time, assess data/types/residents, notify responsible providers/insurers as required, track NY and other applicable deadlines, obtain legal notification decisions, issue accurate notices, remediate and review. Never put credentials or full identity documents in ordinary incident logs. Verify backups through an isolated restore, not merely a dashboard label.

For AML applicability: inventory previous-year covered purchases/sales and seller categories; assess retailer exception and public/foreign sources; document conclusion and implement required program/training/testing. For sanctions: resolve true versus false matches, distinguish rejected/blocked property, document lawful disposition/reporting and restrict sensitive case information. Do not return blocked funds automatically. Government ID collection does not substitute for this process. Keep Sell to Us inquiry-only until separately authorized licensed purchase procedures exist.

## Release and rollback

Require written owner approval, licensed NY counsel approval, verified entity/address, tax advisor rules/registrations, insurance evidence, processor approval and sandbox test sign-off. Then integrate on a preview with a separate database/Stripe test environment. Do not test real customer charges or disclose live wire numbers in a public preview.

Roll out the approved legal version only to new offers; preserve existing orders' terms. If rollback is needed, disable new offers first, preserve all created consent/payment evidence, restore application behavior compatible with existing records, and reconcile in-flight payments/outbox. Do not roll back by dropping evidence or reclassifying accepted contracts. No production migration, frontend link, fee, arbitration provision or new contract behavior was activated by this task.
