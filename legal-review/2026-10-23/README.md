# Gold On The Spot — legal protection and launch review

**DRAFT FOR LICENSED NEW YORK ATTORNEY REVIEW — NOT EFFECTIVE**

Prepared October23,2026 · Version2026-10-23-draft.1 · Branch `draft/legal-framework-2026-10-23`

**Launch recommendation: NO-GO until the listed business, legal and engineering gates are resolved.** No production policy, fee, arbitration clause, payment setting, database migration or checkout contract behavior was changed by this package. The new files are outside the public app and production migrations. This package does not guarantee enforceability or protection against litigation.

## Start here

- [Readable, searchable policy review portal](review.html):16original drafts, mobile layout, print view and a non-submitting checkbox demonstration. Download/open locally; not published on the site.
- [Legal research and severity-ranked findings](RESEARCH.md): dealer benchmarks, authoritative sources, applicability limits and approval decisions.
- [Operational procedures and integration plan](OPERATIONS-AND-INTEGRATION.md): data map, exact target files, contract/payment workflow, shipping, default claims, privacy, marketing, AML, rollback.
- [Tax review register](tax-jurisdiction-review.csv):50states plusDC, explicitly unapproved pending tax-advisor review. Not a tax-rate table.
- [Exact policy archive and hashes](legal-bundle.json): exact text, version, null effective date, per-document hashes and bundle hash.

## All16drafts

1. [Terms of Service](policies/01-terms-of-service.md)
2. [Customer Purchase Agreement](policies/02-customer-purchase-agreement.md)
3. [Privacy Policy](policies/03-privacy-policy.md)
4. [Refund, Return and Cancellation Policy](policies/04-refunds-returns-cancellations.md)
5. [Market Loss and Price Lock Policy](policies/05-market-loss-price-lock.md)
6. [Bank Wire Payment Agreement](policies/06-bank-wire-agreement.md)
7. [Credit and Debit Card Payment Terms](policies/07-card-payment-terms.md)
8. [Cryptocurrency Payment Terms — dormant](policies/08-cryptocurrency-terms.md)
9. [Shipping, Delivery and Insurance Policy](policies/09-shipping-delivery-insurance.md)
10. [Fraud Prevention and Identity Verification Notice](policies/10-fraud-verification-notice.md)
11. [Precious-Metals Risk Disclosure](policies/11-precious-metals-risk.md)
12. [Cookie Policy and Privacy Rights Notice](policies/12-cookies-privacy-rights.md)
13. [Electronic Communications and E-Signature Consent](policies/13-electronic-consent.md)
14. [Arbitration and Dispute Resolution — dormant proposal](policies/14-arbitration-dispute-resolution.md)
15. [Sell to Us Inquiry Terms](policies/15-sell-to-us-inquiry.md)
16. [Website Acceptable Use and Intellectual Property](policies/16-acceptable-use-ip.md)

## Principal findings

| Severity | Finding | Current disposition |
|---|---|---|
| Critical launch/compliance gate | No verified authoritative checkout tax calculation or approved jurisdiction/product matrix. | No unsupported zero rates added;51-jurisdiction review register and fail-closed reference gate prepared. |
| High launch/compliance gate | Live4% generic card surcharge, without pre-quote credit/debit differentiation. | Verified by allowlisted live setting read and quote source. Visa/NY issues documented. No price change made without required authorization. |
| High | Exact LLC identity/DBA/address and required registration/insurance facts not verified. | Clearly marked placeholders; no invented business facts or insurance promise. |
| High | Existing terms allow payment+processing acceptance; proposed model requires an explicit notice. | Separate contract state and acceptance archive prototype; no retroactive rewrite. |
| High | Existing wire due time is tied to placement/customer assent rather than proposed Company acceptance. | Proposed calendar-aware2business-day5PMEastern helper, no holiday assumptions outside supplied approved calendar. |
| High | Complete consent bundle + immutable Company acceptance issuance record needs integration. | Exact version/hash archive, local append-only SQL prototype and testable validation core. |
| High | Tax, insurance, AML/sanctions, privacy retention and marketing suppression operating procedures not all verified. | Detailed proposed procedures; no unsupported compliance claims. |
| High, carried from previous audit | Native Auth recovery/SMS boundary, sandbox provider journey and backup/restore verification remain open. | Not reclassified as fixed by legal drafting. |
| Medium | General liability, default fees, arbitration and short claims windows could be overbroad if copied from dealer benchmarks. | Original narrower drafts, no fixed default fee, preserved rights, dormant arbitration,48-hour reporting preference not forfeiture. |
| Medium | Dormant OpenAI assistant route differs from active Cloudflare UI path. | Data map distinguishes active/dormant; read-only endpoint returned configured:false. Review/update disclosure before activation. |
| Medium research gap | Recent FCC consent-revocation changes identified; final-order full text inaccessible through retrieval. | Specific current-text verification gate; no marketing launch permitted by package. |

These severities concern launch risk, not a representation that every listed issue is an exploitable cybersecurity vulnerability. Current application security tests passed as described below; this task does not certify a fresh exhaustive penetration test.

## What was prepared and affected files

All new files are under `legal-review/2026-10-23/`; **no production source file changed**.

- `policies/*.md`:16consistent original drafts, shared version, no effective date, verified/unverified facts distinguished.
- `RESEARCH.md`, `OPERATIONS-AND-INTEGRATION.md`, `tax-jurisdiction-review.csv`: sources, decisions, data inventory, operational workflows and scoped implementation steps.
- `implementation/contracts.mjs`: strict consent/quote validation, quote lifetime, owner/verification checks, trusted-total consistency, tax gate, disabled unsupported methods/generic surcharge, proposed wire calendar calculation, separate contract/payment/fulfillment transitions, refund-priority display and release gate. Pure reference code; no production HTTP/provider adapter.
- `implementation/ledger.draft.sql`: separate private evidence schema, RLS/no public grants, append-only row triggers, unique quote/acceptance/event records and version/hash consistency. **Not applied**. No transactional production order RPC or complete provider adapter is claimed.
- `implementation/contracts.test.mjs`:44executed reference/archive/database tests.
- `implementation/build-review.py`: reproducible review HTML and exact document manifest.
- `implementation/browser-review.cjs`: local Chromium checks, viewport screenshots and machine-readable results.
- `review.html`, `legal-bundle.json`: generated review artifacts. Draft strings and bundle excluded from the production build by an executed test.
- `evidence/`: test output, browser results, desktop/mobile screenshots, historical legal source copies. Existing historical documents are preserved, not retroactively amended.

The ledger prototype does not prevent a privileged database owner from disabling triggers or altering storage. Production requires narrowly scoped transactional RPCs, separate archive backups/retention controls, administrative auditing and tested restoration. A hash detects mismatching content when compared with a trusted record; it does not by itself prove assent or prevent tampering.

## Tests actually executed

| Test | Actual result | Scope / limit |
|---|---|---|
| New reference/core/archive/PGlite test suite |44passed,0failed | Modified totals, cross-account quote, missing verification/assent, stale version/hash, expired/reused/extended quotes, out-of-stock, unknown/mismatched/expired tax, unsupported methods/fee, wire deadline/DST/weekend/holiday fixtures, invalid admin/customer transitions, late payment reconciliation, refund visibility, private read/write denial, append-only edits, duplicate quote/acceptance/events and archive hashes. |
| Existing `npm run check` |203passed,0failed; search check and production build succeeded |9signup,126security,36email,32support/selling/market tests. Automated suite is not a live customer or payment-provider journey. |
| Local browser review portal |Passed390×844,768×1024,1440×1000 |16policies/links, full-text search, filtered navigation, unchecked box, permanently disabled submission, keyboard focus, no horizontal overflow/page exceptions/external requests. |
| Production-build exclusion |Passed |No new draft bundle hash, version or private review marker in built JS/HTML/JSON/CSS. |
| Read-only configuration inspection |Completed |Cards/wire enabled; crypto disabled;4%card fee; manual capture false; order email and SMS requirement enabled. No secret values or customer data queried for this report. |

Browser testing initially found a numeric-ID selector bug in the **new local preview**. The selector was corrected and all three viewport runs were repeated successfully. No production UI was involved.

Evidence: [new tests](evidence/contracts-test-results.txt), [existing regression log](evidence/existing-regression-results.txt), [browser results](evidence/browser-review-results.json), [mobile preview](evidence/legal-review-mobile.jpg), [desktop preview](evidence/legal-review-desktop.jpg). These screenshots show a new local review portal, not a production before/after redesign.

### Not executed / not represented as passed

- Revised legal checkout connected to production or preview APIs, real consent archive retrieval through authenticated customer routes, transactional acceptance/outbox races, live admin acceptance and customer withdrawal concurrency.
- Actual Stripe test-mode authorization/capture/3DS/refund/dispute/provider-webhook journey; real wires/crypto; no financial transactions performed.
- Actual customer email/SMS delivery for revised notices; no new messages sent.
- New privacy deletion/appeal/vendor deletion/retention jobs, marketing STOP/unsubscribe delivery and suppression end-to-end.
- Fifty-state tax correctness, confirmed insurance coverage, legal enforceability, verified corporate records or a backup restoration exercise.

## Required owner and professional actions

1. Supply the exact LLC legal name, formation/registration evidence, any DBA, authorized signatory and verified business notice/mailing address. Confirm support mailbox ownership/monitoring. Do not post bank credentials in this review package.
2. Have licensed NY commercial/consumer/privacy counsel review all16drafts, especially acceptance mechanics, remedies, liability caps, arbitration, shipping/insurance, state-law applicability, electronic consent and current FCC rules. Approve a specific version in writing.
3. Resolve the4%card fee with Stripe/acquirer and counsel. Do not treat the draft as approval to collect it, to surcharge debit, or to charge damages to saved cards.
4. Have a qualified tax professional verify NY registration and implement/approve nexus and bullion-product treatment for each enabled destination. No all-state exemption is assumed.
5. Confirm actual insurance, carrier, maximum shipment value, signatures and achievable ship-by promise. Approve the proposed3–7business-day dispatch policy only after operational verification.
6. Approve or revise the2business-day wire deadline,5PMEastern cutoff and bank holiday calendar. Verify beneficiary/instructions independently.
7. Complete AML/sanctions applicability and business-license analysis; keep Sell to Us inquiry-only until later authority and agreements are approved.
8. Assign privacy/security/compliance staff, adopt justified retention, verify vendor contracts, implement deletion/suppression/incident workflows and test backups.
9. Integrate the approved version in an isolated database/Stripe sandbox, execute the outstanding end-to-end and attack tests, then obtain explicit approval for public release. No paid Supabase plan, check payments, new crypto method, marketing or arbitration was activated.

## Reproduce locally

From repository root:

```sh
python legal-review/2026-10-23/implementation/build-review.py
npm run check
node --test legal-review/2026-10-23/implementation/contracts.test.mjs
NODE_PATH="$CODEX_PRIMARY_RUNTIME_NODE_MODULES" node legal-review/2026-10-23/implementation/browser-review.cjs
```

The browser script uses the existing local `.verification/chromium` executable. Substitute an installed Playwright Chromium path in another environment. Holiday inputs in tests are explicit fixtures, not a certified production holiday calendar. Do not run the draft SQL against production.
