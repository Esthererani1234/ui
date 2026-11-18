# Node.js security alert response — October 23, 2026

Status: **partially remediated; hosted runtime patch and Stripe response blocked on provider/account access.** Production has not been changed by this patch. Do not describe this incident as resolved.

## Verified facts

- The screenshots' versions correspond to the official October 21 Node.js security release, including CVE-2026-111497. Screenshots alone do not authenticate an email sender or establish compromise.
- Vercel's advisory states that its WAF blocks known inbound exploit patterns, but fetched Brotli responses require the Node runtime patch. It says Node 24 projects need no major-version setting change because Vercel manages patch versions.
- Project `ui`, serving goldonthespot.com, is configured for Node 24.x. Production remains deployment `dpl_7cH63oobCcDoKKWHR5VSwUp1HcUU`, commit `5e03484a74088c9e690e68a159ffe58600531fa6` at inspection time.
- The prepared security preview, deployment `dpl_98YbJfgMiCB4VeiLa66rd5fBo2ez`, commit `6f97ae6d0150a7688445b37244f4857245f5986f`, built successfully on **Node 24.22.1**.
- A real GET to that preview's `/api/payments/config` at **8:59:52 AM EDT** produced the private runtime log: `node_runtime_security {"nodeVersion":"24.21.0","advisory":"2026-10-21","patched":false,"projectRuntimeSupported":false}`. Thus a patched build machine does **not** establish a patched deployed function. Preview payment mutations remained disabled.
- This observation directly establishes the preview's runtime, not the exact version of every current production worker. The existing production deployment does not emit exact patch versions, so production patch status is **not verified**.
- The local host initially had Node 24.19.0. Tests were run with a separate official Node 24.22.1 distribution, downloaded over HTTPS and checked against the published SHA-256. The managed workspace's default runtime was not globally replaced.
- A 24-hour Vercel runtime-log request was rejected because the plan retains only one hour. A scoped 30-minute production log query returned no records. This is not evidence that the preceding week was free of compromise.
- The Stripe plugin is available but not connected. Stripe API activity, key rotation, payouts and account settings were not inspected or changed. No secret key was requested, retrieved or printed.

## Changes prepared in PR59

1. `package.json` and lock metadata require Node >=24.22.1 <25.
2. `.nvmrc` selects 24.22.1; CI requests the latest satisfying patched Node24 release.
3. Development, build and check commands reject unsupported/unpatched project runtimes.
4. A server-only payment-worker diagnostic records the Node version and patch status once per worker. It contains no request data, keys, environment dump or customer information, and does not expose a public diagnostic endpoint.
5. Thirteen tests exercise patch boundaries, prerelease rejection, supported project major and safe once-per-worker logging.

These changes do not alter taxes, fees, legal agreements, payment totals, authentication, webhook signature checks or order behavior. They do not silently disable payment processing. A runtime log is detection, not remediation of the host's binary.

## Executed validation

- 216 automated tests passed on Node24.22.1:13runtime tests plus203existing application tests.
- Product search check and production build passed.
- Production dependency audit:0known vulnerabilities.
- GitHub `verify` check succeeded for the prepared commit.
- Vercel preview build succeeded and explicitly printed Node24.22.1.
- Protected preview GET returned200 and correctly reported payment methods disabled in the preview.
- Private runtime diagnostic successfully detected **unpatched Node24.21.0**. This is the blocking result, not a passed security condition.
- No exploit payloads, live payments, customer messages, key revocations or destructive cleanup were performed.

## Next required actions

### Vercel runtime patch

Ask Vercel to confirm rollout of Node24.22.1 or later to actual functions for this project, not only its build image. Suggested support message (draft, not sent):

> Our Node24 project ui serves goldonthespot.com. The October21 security advisory says you manage Node24 patch versions. Deployment dpl_98YbJfgMiCB4VeiLa66rd5fBo2ez builds on24.22.1 but its live payment function logged process.version24.21.0 on October23 at12:59:52UTC. Please complete or confirm the patched function-runtime rollout for this project and explain any required redeployment. We need verification for production workers, including fetched-response exposure, not just WAF coverage.

After provider confirmation, recheck the preview's actual runtime, merge only the tested patch, deploy, invoke the production read-only config route, and verify production logs show a patched runtime. Repeat normal protected API/webhook-negative checks. A build check alone is insufficient. Do not disable Vercel protections or introduce a custom runtime workaround without an explicitly reviewed plan.

### Stripe review and key rotation

Connect Stripe for account review or use the authenticated Stripe Dashboard. Independently verify the notice there. Review Workbench request logs, unfamiliar requests, charges/refunds, payouts and account configuration. Do not assume no visible activity means a key was never exposed.

Coordinate rotation after securing all environments using the key: create/roll the key through Stripe, update every legitimate server-side consumer through its secret manager, deploy/test the replacement, then retire the old credential according to the incident risk and chosen overlap window. Do not revoke the only working key before replacement is installed unless immediate containment is deliberately chosen. If active abuse is detected, urgent containment may take priority over availability. Webhook signing secrets are distinct from API keys; inventory exposure and rotate them separately if warranted. Never paste secrets in chat or commit them.

The available unconnected Stripe plugin may support activity review; its ability to rotate account keys must be confirmed. No rotation capability is assumed.

## Sources

- Node.js advisory: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- Node24.22.1 release: https://nodejs.org/en/blog/release/v24.22.1
- Vercel runtime/WAF guidance: https://vercel.com/kb/bulletin/node-js-security-advisory
- Stripe key management: https://docs.stripe.com/keys
- Stripe request logs: https://docs.stripe.com/development/dashboard/request-logs

Sources checked October23,2026. No finding here establishes that the business was compromised, and the available evidence cannot rule it out.
