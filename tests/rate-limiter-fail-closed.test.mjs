// Rate limiter: opt-in failClosed for /api/miniapp; default stays fail-open for
// ai-client / crm-intake. Store errors are simulated; no Netlify Blobs or GAS calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';

const FAKE_BOT_TOKEN = '123456:TEST-FAKE-BOT-TOKEN';
process.env.GAS_WEB_APP_URL = 'https://gas.test/exec';
process.env.GAS_API_KEY = 'test-gas-key';
process.env.TELEGRAM_BOT_TOKEN = FAKE_BOT_TOKEN;

const { checkLimit } = await import('../netlify/functions/shared/rate-limiter.mjs');
const { createMiniappHandler } = await import('../netlify/functions/miniapp-gas.mjs');

const brokenStore = {
    get: async () => { throw new Error('blobs down (test)'); },
    set: async () => { throw new Error('blobs down (test)'); },
};
const req = () => new Request('https://example.test/x', { headers: { 'x-forwarded-for': '203.0.113.7' } });

test('default (no failClosed): store error still fails open — existing callers unchanged', async () => {
    const r = await checkLimit(req(), 'ai-test', 5, { store: brokenStore });
    assert.equal(r.allowed, true);
    assert.equal(r.unavailable, undefined);
});

test('failClosed: store error → allowed:false, unavailable:true', async () => {
    const r = await checkLimit(req(), 'miniapp-test', 5, { store: brokenStore, failClosed: true });
    assert.equal(r.allowed, false);
    assert.equal(r.unavailable, true);
});

test('failClosed with a healthy store behaves like the normal limiter', async () => {
    const m = new Map();
    const store = { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
    let last;
    for (let i = 0; i < 3; i++) last = await checkLimit(req(), 'miniapp-ok', 2, { store, failClosed: true, subject: 'tg:1' });
    assert.equal(last.allowed, false);
    assert.equal(last.unavailable, undefined);
});

function sign(fields) {
    const pairs = Object.keys(fields).sort().map((k) => k + '=' + fields[k]);
    const secret = createHmac('sha256', 'WebAppData').update(FAKE_BOT_TOKEN).digest();
    const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const p = new URLSearchParams(fields);
    p.set('hash', hash);
    return p.toString();
}
const now = () => Math.floor(Date.now() / 1000);
const initData = () => sign({ auth_date: String(now()), query_id: 'TEST', user: JSON.stringify({ id: 4242, username: 'test_user' }) });

test('/api/miniapp: Blobs down → 503 rate_limit_unavailable with a friendly message, zero fetches', async () => {
    const calls = [];
    const fetchImpl = async (u) => { calls.push(String(u)); return new Response('{"success":true}', { status: 200 }); };
    const handler = createMiniappHandler({ fetchImpl, rateStore: brokenStore });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { calls.push('global:' + u); throw new Error('unexpected'); };
    try {
        const res = await handler(new Request('https://example.test/api/miniapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'telegram_client_update', initData: initData(), name: 'Test Person' }),
        }));
        const out = await res.json();
        assert.equal(res.status, 503);
        assert.equal(out.error, 'rate_limit_unavailable');
        assert.match(out.message, /332-2245/);
        assert.equal(calls.length, 0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('crm-intake and ai-client do not opt into failClosed', async () => {
    const fs = await import('node:fs');
    for (const f of ['../netlify/functions/crm-intake.mjs', '../netlify/functions/shared/ai-client.mjs']) {
        const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
        assert.equal(/failClosed/.test(src), false, f);
    }
});

test('brand.js shows the server message for rate_limit_unavailable', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../shared/brand.js', import.meta.url), 'utf8');
    assert.match(src, /rate_limit_unavailable/);
});
