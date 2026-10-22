import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the real Edge handler with isolated DB/provider fakes. No SMS is sent.
const source = await readFile(new URL('../supabase/functions/customer-sms/index.ts', import.meta.url), 'utf8');
const shared = await readFile(new URL('../supabase/functions/_shared/security.ts', import.meta.url), 'utf8');
const helpers = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(shared.replace(/^import type .*;\n/m, ''))).toString('base64'));
const code = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, ''));
const userId = '10000000-0000-4000-8000-000000000001';
const challengeId = '30000000-0000-4000-8000-000000000001';
const token = ['{}', JSON.stringify({ session_id: '20000000-0000-4000-8000-000000000001' }), '{}'].map(x => Buffer.from(x).toString('base64url')).join('.');

function harness({ available = true, completeError = null, enrolled = false, recovery = false } = {}) {
  let handler, sends = 0;
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }), admin:{updateUserById:async()=>{calls.push({name:'update_password'});return {error:null}},signOut:async(jwt,scope)=>{calls.push({name:'revoke_sessions',scope});return {error:null}}} },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'consume_recovery_sms') return {data:recovery};
      if (name === 'check_customer_session') return { data: true };
      if (name === 'consume_security_rate_limit') return { data: 0 };
      if (name === 'can_enroll_customer_phone') return { data: available };
      if (name === 'get_sms_provider_secret') return { data: { provider: 'messagebird', access_key: 'bk_us1_fixture_only_not_a_real_key' } };
      if (name === 'claim_sms_attempt') return { data: { id: challengeId, phone: '+12025550123', attempt_count: 1 } };
      if (name === 'complete_sms_challenge') return { data: !completeError, error: completeError };
      throw new Error('Unexpected RPC ' + name);
    },
    from: (table) => {
      const result = table === 'profiles' ? { phone: '+12025550123', phone_verified_at: enrolled ? '2026-01-01' : null }
        : table === 'app_settings' ? Object.entries({ sms_provider_name: 'messagebird', sms_provider_ready: true, customer_sms_mfa_required: true, sms_sender: 'GoldOnTheSpot', sms_provider_tested_at: '2026-01-01' }).map(([key, value]) => ({ key, value }))
        : { id: challengeId };
      const chain = { delete:()=>{calls.push({name:'delete_sms',table});return chain}, select: () => chain, eq: () => chain, in: () => chain, insert: () => chain, single: () => chain, maybeSingle: () => chain, then: resolve => Promise.resolve({ data: result }).then(resolve) };
      return chain;
    },
  };
  const env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server' };
  new Function('createClient', ...Object.keys(helpers), 'Deno', 'fetch', code)(
    () => client, ...Object.values(helpers), { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    async (url) => { sends++; return Response.json(url.endsWith('/check') ? { success: true } : { id: 'fixture-verification' }); },
  );
  return {
    calls, sent: () => sends,
    request: body => handler(new Request('https://example.test/customer-sms', { method: 'POST', headers: { origin: 'https://goldonthespot.com', authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  };
}

test('duplicate phone is rejected before paid SMS, with a safe actionable error', async () => {
  const app = harness({ available: false });
  const response = await app.request({ action: 'send', phone: '(202) 555-0123', purpose: 'signup' });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'phone_already_registered');
  assert.match(body.error, /^This phone number already belongs to an account\./);
  assert.equal(app.sent(), 0);
  assert.equal(app.calls.find(x => x.name === 'can_enroll_customer_phone').args.p_phone, '+12025550123');
});
test('existing owner can sign in and submitted alternate phone cannot redirect the code', async () => {
  const app = harness({ enrolled: true });
  const response = await app.request({ action: 'send', phone: '2025550999', purpose: 'signin' });
  assert.equal(response.status, 200);
  assert.equal(app.sent(), 1);
  assert.equal(app.calls.find(x => x.name === 'can_enroll_customer_phone').args.p_phone, '+12025550123');
});
test('a phone claimed during OTP entry cannot create a verified session', async () => {
  const app = harness({ completeError: { code: 'P2001' } });
  const response = await app.request({ action: 'verify', challenge_id: challengeId, code: '123456' });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'phone_already_registered');
  assert.equal(body.verified, undefined);
});
test('available phone still completes normal signup', async () => {
  const app = harness();
  assert.equal((await app.request({ action: 'send', phone: '2025550123', purpose: 'signup' })).status, 200);
  const response = await app.request({ action: 'verify', challenge_id: challengeId, code: '123456' });
  assert.deepEqual(await response.json(), { verified: true });
});

test('password reset consumes a fresh recovery grant before changing password and revokes sessions',async()=>{const app=harness({enrolled:true,recovery:true});const res=await app.request({action:'password_update',password:'Fixture-new-password-123'});assert.equal(res.status,200);assert.ok(app.calls.findIndex(c=>c.name==='consume_recovery_sms')<app.calls.findIndex(c=>c.name==='update_password'));assert.equal(app.calls.find(c=>c.name==='revoke_sessions').scope,'global');assert.ok(app.calls.some(c=>c.name==='delete_sms'))});
test('missing, stale or consumed recovery grant cannot update the password',async()=>{const app=harness({enrolled:true,recovery:false});const res=await app.request({action:'password_update',password:'Fixture-new-password-123'});assert.equal(res.status,403);assert.equal(app.calls.some(c=>c.name==='update_password'),false)});
