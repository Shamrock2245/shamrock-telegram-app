// /api/checkin-geo-alert requires caller auth before any outbound call:
//   - server: X-GAS-API-Key header == env GAS_API_KEY, or
//   - Telegram mini-app: body.initData signed with env TELEGRAM_BOT_TOKEN (fresh auth_date).
// All fixtures are obviously fake; fetch is mocked, so no real Slack post or GAS call happens.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const FAKE_BOT_TOKEN = '123456:TEST-FAKE-BOT-TOKEN';
const FAKE_GAS_KEY = 'test-gas-key';
process.env.GAS_WEB_APP_URL = 'https://gas.test/exec';
process.env.GAS_API_KEY = FAKE_GAS_KEY;
process.env.TELEGRAM_BOT_TOKEN = FAKE_BOT_TOKEN;

const { default: handler } = await import('../netlify/functions/checkin-geo-alert.mjs');

// Jacksonville check-in with home county Lee: well over 50 miles, so an authorized call alerts.
const FAR = { latitude: 30.3322, longitude: -81.6557, homeCounty: 'lee', caseNumber: 'TEST-1', defendantName: 'Test Person' };

function signInitData({ token = FAKE_BOT_TOKEN, authDate = Math.floor(Date.now() / 1000), userId = 4242 } = {}) {
    const fields = { auth_date: String(authDate), query_id: 'TEST', user: JSON.stringify({ id: userId, username: 'test_user' }) };
    const pairs = Object.keys(fields).sort().map((k) => k + '=' + fields[k]);
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const params = new URLSearchParams(fields);
    params.set('hash', hash);
    return params.toString();
}

async function call(body, headers = {}) {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response('{}', { status: 200 });
    };
    try {
        const res = await handler(new Request('https://example.test/api/checkin-geo-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        }));
        return { res, out: await res.json().catch(() => null), calls };
    } finally {
        globalThis.fetch = realFetch;
    }
}

test('unauthenticated request is rejected with 401 and zero outbound fetches', async () => {
    const { res, calls } = await call(FAR);
    assert.equal(res.status, 401);
    assert.deepEqual(calls, []);
});

test('bad credentials are rejected with zero outbound fetches', async () => {
    const cases = [
        ['wrong server key', FAR, { 'X-GAS-API-Key': 'wrong-key' }],
        ['empty server key', FAR, { 'X-GAS-API-Key': '' }],
        ['initData signed with another token', { ...FAR, initData: signInitData({ token: '654321:OTHER-FAKE-TOKEN' }) }, {}],
        ['tampered initData', { ...FAR, initData: signInitData().replace('test_user', 'evil_user') }, {}],
        ['stale initData (2 days old)', { ...FAR, initData: signInitData({ authDate: Math.floor(Date.now() / 1000) - 2 * 86400 }) }, {}],
        ['garbage initData', { ...FAR, initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef' }, {}],
    ];
    for (const [name, body, headers] of cases) {
        const { res, calls } = await call(body, headers);
        assert.equal(res.status, 401, name);
        assert.deepEqual(calls, [], name + ': no fetch');
    }
});

test('fails closed when GAS_API_KEY and TELEGRAM_BOT_TOKEN are unset', async () => {
    const saved = { k: process.env.GAS_API_KEY, t: process.env.TELEGRAM_BOT_TOKEN };
    delete process.env.GAS_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
        const a = await call(FAR, { 'X-GAS-API-Key': '' });
        const b = await call({ ...FAR, initData: signInitData() });
        assert.equal(a.res.status, 401);
        assert.equal(b.res.status, 401);
        assert.deepEqual([...a.calls, ...b.calls], []);
    } finally {
        process.env.GAS_API_KEY = saved.k;
        process.env.TELEGRAM_BOT_TOKEN = saved.t;
    }
});

test('valid signed Telegram initData passes and posts one (mocked) keyed Slack alert', async () => {
    const { res, out, calls } = await call({ ...FAR, initData: signInitData() });
    assert.equal(res.status, 200);
    assert.equal(out.alert, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, 'post_slack_message');
    assert.equal(calls[0].body.apiKey, FAKE_GAS_KEY);
    assert.ok(!JSON.stringify(out).includes(FAKE_GAS_KEY));
});

test('valid server key header passes; near check-in does not alert and makes no fetch', async () => {
    const far = await call(FAR, { 'X-GAS-API-Key': FAKE_GAS_KEY });
    assert.equal(far.res.status, 200);
    assert.equal(far.out.alert, true);
    assert.equal(far.calls.length, 1);
    const near = await call({ ...FAR, latitude: 26.64, longitude: -81.87 }, { 'X-GAS-API-Key': FAKE_GAS_KEY });
    assert.equal(near.res.status, 200);
    assert.equal(near.out.alert, false);
    assert.deepEqual(near.calls, []);
});

test('OPTIONS preflight still answers without auth', async () => {
    const res = await handler(new Request('https://example.test/api/checkin-geo-alert', { method: 'OPTIONS' }));
    assert.equal(res.status, 204);
});
