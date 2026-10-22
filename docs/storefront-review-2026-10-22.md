# Storefront reliability review — 22 October 2026

Scoped frontend review of the React/Vite routing, shared catalog cache, account guards, and admin support flow. No deployment, production mutation, or commit was performed. CheckoutPage, AccountPage, InfoPage, and payment components were left to the release owner, except the explicitly delegated bank-settings form in EnterprisePanels. The owner's appended wire-agreement CSS was preserved.

## Fixes

| Verified behavior | Change |
| --- | --- |
| Catalog request failures appeared as “No products found” or “Product not found.” | ShopPage and ProductPage distinguish request errors from genuine empty/missing results and offer working retries. Cached details receive an explicit refresh-error notice. |
| Mobile navigation stayed expanded when switching shop categories on the same pathname. | Layout closes the menu on query-string changes as well as pathname changes. |
| Failed image requests left broken images in product cards and galleries. | Shared ProductImage renders an accessible unavailable-image placeholder; switching to a valid gallery image recovers normally. This was tested with a failing image fixture, not a currently broken production asset. |
| Switching/filtering admin tickets discarded unsent replies and selected status. | SupportAdminPanel retains per-ticket drafts and retry request IDs in memory while the panel remains mounted, with a shared submission lock. |
| Admin replies were enabled after conversation loading failed. | Replies remain blocked until a successful message read; errors and refresh controls remain visible. Standalone status updates remain available. |
| Bank-settings GET failures silently resembled an unconfigured account. | EnterprisePanels shows loading, HTTP/network/invalid-response errors and retry; editing/saving remain disabled until loading succeeds. Failed saves retain input. Successful saves clear account number/audit reason. Masked account values and read-only metadata are not submitted. Labels identify Domestic wire ABA, possible ACH differences, and optional international SWIFT/BIC. |

The bank form includes a 20-second read timeout and cancels stale reads on unmount. Server error propagation, atomic settings saves, validation, and checkout changes belong to the separate release work.

## Verification

- Product-search checks, **9 signup tests**, **13 support tests**, production build, and whitespace checks passed.
- Local browser regressions passed: catalog failure/retry versus genuine empty results; image fallback/gallery recovery; mobile category navigation; draft/status retention through ticket switching and filtering; retry-ID reuse; conversation-error reply blocking; and signed-out account return-URL preservation.
- Bank-form fixtures passed HTTP/network/malformed-response failures, retry, configured/unconfigured states, disabled controls before loading, failed/successful save feedback, masked-value handling, requested labels, and mobile width checks.
- Existing support browser fixtures also passed customer creation/reply/reopen, validation, conflict recovery, tracking/deep links, and mobile layouts. Both fixture suites reported **zero uncaught page errors**.
- Read-only live browser smoke of `https://goldonthespot.com/` and the linked Buffalo product page completed without page or console errors. All **8 observed homepage images decoded**.
- Public catalog/image GET checks at **2026-10-22 21:32:54 UTC** found **6 active products and 16 unique image URLs**. All 16 returned **HTTP 200**, an image content type, and a nonempty body. No active product lacked an image. This checks response status/content, not browser decoding of all 16 images.

## Commands and local evidence

Run from the repository root:

```bash
npm run check:search
node --test scripts/check-signup.mjs
npm run check:support
npm run build
git diff --check

export NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules
EXPECT_FIXED=1 node .verification/check-storefront-reliability.cjs
node .verification/check-support.cjs
node .verification/live-browser.cjs
node .verification/check-public-catalog-images.cjs
```

The browser scripts use Chromium at `.verification/chromium`. These scripts and artifacts are local, gitignored verification aids, not committed CI tests. Image results are in `.verification/public-catalog-image-status.json`; support and bank screenshots are `.verification/storefront-support-reliability.png` and `.verification/bank-settings-reliability-{mobile,desktop}.png`.

## Limits

Authenticated browser journeys used synthetic sessions and intercepted API responses. **No real authenticated customer/admin journey was exercised**, and no actual ticket, bank setting, payment, email, SMS, or production record was changed. Live checks were public reads only. This pass did not validate the release owner's new checkout flows, real delivery/authentication, or the complete combined release. Results establish the scoped fixes at test time, not an all-bugs-clear or launch-readiness certification.

## Customer support layout follow-up

At the owner's request, redesigned `src/pages/SupportPage.jsx` with a page-scoped import of the new `src/styles/supportTickets.css`. This follow-up did not edit `src/styles.css`, admin layouts, backend/email code, or other site pages.

- Conversations and the new-request composer now lead the page; FAQs sit below the workspace. The compact navy hero, gold accents, consistent cards, and responsive single-column layout match the storefront.
- Ticket summaries separate reference, subject, readable status, and update date. Expanded conversations distinguish customer/support senders with avatars, timestamps, and message surfaces. An inset reply composer separates sending from closing a ticket.
- Preserved create/reply/reopen operations, request-ID retries, deep links, receipt focus, queued-email feedback, and signed-out return destinations. Added labeled conversation regions, expanded-state controls, visible focus styles, and message-loading feedback.
- Account changes clear conversation errors; late reply/close success and failure responses are ignored if the owner changed. Reply controls and their handler reject submission until messages have loaded successfully.

The existing production-build `check-support.cjs` passed without locator changes, covering create/reply/reopen, failures, retained drafts/request IDs, focused receipts, tracking/reload links, and mobile layout. The layout build passed. Local screenshots: `.verification/support-redesign-desktop.png`, `support-redesign-768.png`, and `support-redesign-390.png`. The support content also fits 320px; the existing global header/search controls extend approximately 9px beyond that viewport and were left outside this page-only scope.

The final `check-support-layout.cjs` passed at 1440/768/390/320px, including sender/status rendering, labeled regions, message-read failure/retry, reply blocking, cleared errors on account changes, ignored stale success/failure responses, signed-out deep links, and empty state. Both final browser suites reported zero uncaught page errors. Source is frozen; no redesign blocker was found.

Additional local browser command:

```bash
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node .verification/check-support-layout.cjs
```

The owner reports working email delivery. This redesign did not send or independently verify real email; browser requests and authenticated sessions remained synthetic. No deployment or commit was performed by this frontend pass.
