import { test } from "node:test";
import assert from "node:assert/strict";
import { saveVerifiedSignup, authDestination, isEmailSendRateLimit } from "../src/lib/signupCompletion.js";

const input = { userId: "test-user", password: "test-only-password", details: { first_name: "Test", last_name: "Customer", phone: "+12025550123" } };
function fakeClient({ passwordError, metadataError, profileError, userId = input.userId, confirmed = true, missingProfile = false } = {}) {
  const calls = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email_confirmed_at: confirmed ? "2026-09-01" : null } } }),
      updateUser: async (payload) => { calls.push(payload); return { error: "password" in payload ? passwordError : metadataError }; },
    },
    from: (table) => {
      assert.equal(table, "profiles");
      return { update: (details) => ({ eq: (key, value) => {
        assert.equal(key, "id"); assert.equal(value, input.userId);
        calls.push({ profile: details });
        return { select: () => ({ single: async () => ({ error: profileError, data: missingProfile ? null : { id: input.userId } }) }) };
      } }) };
    },
  };
  return { client, calls };
}

test("new signup: same_password still saves metadata and profile", async () => {
  const { client, calls } = fakeClient({ passwordError: { code: "same_password" } });
  await saveVerifiedSignup(client, input);
  assert.deepEqual(calls, [{ password: input.password }, { data: input.details }, { profile: input.details }]);
});
test("abandoned signup: latest password and details are applied", async () => {
  const { client, calls } = fakeClient();
  await saveVerifiedSignup(client, input);
  assert.equal(calls.length, 3);
});
test("genuine password rejection is not treated as success", async () => {
  const { client, calls } = fakeClient({ passwordError: { code: "weak_password" } });
  await assert.rejects(saveVerifiedSignup(client, input), { code: "weak_password" });
  assert.equal(calls.length, 1);
});
test("metadata failure blocks completion", async () => {
  const { client, calls } = fakeClient({ metadataError: { code: "request_timeout" } });
  await assert.rejects(saveVerifiedSignup(client, input), { code: "request_timeout" });
  assert.equal(calls.length, 2);
});
test("profile failure followed by retry with already-saved password succeeds", async () => {
  const first = fakeClient({ profileError: { code: "42501" } });
  await assert.rejects(saveVerifiedSignup(first.client, input), { code: "42501" });
  await saveVerifiedSignup(fakeClient({ passwordError: { code: "same_password" } }).client, input);
});
test("zero updated rows is not success", async () => {
  await assert.rejects(saveVerifiedSignup(fakeClient({ missingProfile: true }).client, input));
});
test("unconfirmed or different session cannot save signup details", async () => {
  for (const options of [{ userId: "other" }, { confirmed: false }]) {
    const { client, calls } = fakeClient(options);
    await assert.rejects(saveVerifiedSignup(client, input));
    assert.equal(calls.length, 0);
  }
});
test("only email-specific rate limits enter email retry flow", () => {
  assert.equal(isEmailSendRateLimit({ code: "over_email_send_rate_limit" }), true);
  assert.equal(isEmailSendRateLimit({ status: 429, code: "over_request_rate_limit" }), false);
});
test("destinations default home for signup and preserve checkout", () => {
  assert.equal(authDestination(null, "/"), "/");
  assert.equal(authDestination("/checkout", "/"), "/checkout");
  assert.equal(authDestination(null), "/account");
  for (const invalid of ["//evil.test", "/\\evil.test", "/\nevil.test", "https://evil.test", ""]) {
    assert.equal(authDestination(invalid, "/"), "/");
  }
});
