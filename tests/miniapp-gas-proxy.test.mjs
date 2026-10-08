// /api/miniapp: the only path from the Mini App pages to GAS.
// Refusals (unauthenticated, tampered, stale, another user's phone or case) make ZERO
// outbound fetches. A valid request forwards once to mocked GAS with the key.
// Fixtures are fake; fetch is mocked; no real texts, Slack posts or GAS calls.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

const FAKE_BOT_TOKEN = '123456:TEST-FAKE-BOT-TOKEN';
const FAKE_GAS_KEY = 'test-gas-key';
process.env.GAS_WEB_APP_URL = 'https://gas.test/exec';
process.env.GAS_API_KEY = FAKE_GAS_KEY;
process.env.TELEGRAM_BOT_TOKEN = FAKE_BOT_TOKEN;

const { createMiniappHandler, WRITE_ACTIONS, LOOKUP_ACTIONS } = await import('../netlify/functions/miniapp-gas.mjs');
const { default: statusProxy } = await import('../netlify/functions/status-proxy.mjs');

const ME = 4242;
const OTHER = 9999;
const MY_PHONE = '+1 (555) 010-0001'; // 555-01xx: reserved fictional range
const OTHER_PHONE = '5550100002';
const now = () => Math.floor(Date.now() / 1000);

function sign(fields, token = FAKE_BOT_TOKEN) {
    const pairs = Object.keys(fields).sort().map((k) => k + '=' + fields[k]);
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const params = new URLSearchParams(fields);
    params.set('hash', hash);
    return params.toString();
}
const initData = ({ userId = ME, authDate = now(), token } = {}) =>
    sign({ auth_date: String(authDate), query_id: 'TEST', user: JSON.stringify({ id: userId, username: 'test_user' }) }, token);
const contact = ({ userId = ME, phone = MY_PHONE, authDate = now(), token } = {}) =>
    sign({ auth_date: String(authDate), contact: JSON.stringify({ user_id: userId, phone_number: phone, first_name: 'Test' }) }, token);

function memoryStore() {
    const m = new Map();
    return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
}

async function call(body, { method = 'POST', rateStore = memoryStore(), handler } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true, caseData: { name: 'Test Person' } }), { status: 200 });
    };
    const h = handler || createMiniappHandler({ fetchImpl, rateStore });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...a) => { calls.push({ url: String(a[0]), global: true }); throw new Error('unexpected global fetch'); };
    try {
        const res = await h(new Request('https://example.test/api/miniapp', {
            method,
            headers: { 'Content-Type': 'application/json' },
            ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
        }));
        return { res, out: await res.json().catch(() => null), calls };
    } finally {
        globalThis.fetch = realFetch;
    }
}

const LOOKUP = { action: 'telegram_status_lookup', initData: initData(), contact: contact(), phone: '5550100001' };

test('refusals: unauthenticated, tampered, stale or wrong-token initData → 401, zero fetches', async () => {
    const cases = {
        'no initData': { action: 'telegram_checkin_log' },
        'garbage initData': { action: 'telegram_checkin_log', initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef' },
        'tampered initData': { action: 'telegram_checkin_log', initData: initData().replace('test_user', 'evil_user') },
        'stale initData': { action: 'telegram_checkin_log', initData: initData({ authDate: now() - 2 * 86400 }) },
        'other bot token': { action: 'telegram_checkin_log', initData: initData({ token: '654321:OTHER-FAKE-TOKEN' }) },
        'lookup, no initData': { ...LOOKUP, initData: '' },
    };
    for (const [name, body] of Object.entries(cases)) {
        const { res, calls } = await call(body);
        assert.equal(res.status, 401, name);
        assert.deepEqual(calls, [], name);
    }
});

test("refusals: lookups for another user's phone or case, or without a valid signed contact → zero fetches", async () => {
    const cases = [
        ['no contact', { ...LOOKUP, contact: undefined }, 401],
        ['tampered contact (phone swapped)', { ...LOOKUP, contact: contact().replace('010-0001', '010-0002') }, 401],
        ['stale contact', { ...LOOKUP, contact: contact({ authDate: now() - 2 * 86400 }) }, 401],
        ['contact signed by another bot', { ...LOOKUP, contact: contact({ token: '654321:OTHER-FAKE-TOKEN' }) }, 401],
        ["another user's signed contact", { ...LOOKUP, contact: contact({ userId: OTHER, phone: OTHER_PHONE }) }, 403],
        ["another user's phone typed", { ...LOOKUP, phone: OTHER_PHONE }, 403],
        ['malformed typed phone', { ...LOOKUP, phone: '555' }, 403],
        ["case-number lookup (another user's case)", { ...LOOKUP, phone: '', caseNumber: 'TEST-OTHER-1' }, 403],
    ];
    for (const action of LOOKUP_ACTIONS) {
        for (const [name, body, status] of cases) {
            const { res, calls } = await call({ ...body, action });
            assert.equal(res.status, status, `${action}: ${name}`);
            assert.deepEqual(calls, [], `${action}: ${name}`);
        }
    }
});

test('refusals: unknown action, GET, bad JSON, oversize upload, missing config → zero fetches', async () => {
    const a = await call({ action: 'send_court_reminders', initData: initData() });
    assert.equal(a.res.status, 400);
    const b = await call(null, { method: 'GET' });
    assert.equal(b.res.status, 405);
    const c = await call('{not json');
    assert.equal(c.res.status, 400);
    const d = await call({ action: 'telegram_mini_app_upload', initData: initData(), base64Data: 'A'.repeat(5_000_001) });
    assert.equal(d.res.status, 413);
    const saved = process.env.GAS_API_KEY;
    delete process.env.GAS_API_KEY;
    try {
        const e = await call({ action: 'telegram_checkin_log', initData: initData() });
        assert.equal(e.res.status, 503);
        assert.deepEqual(e.calls, []);
    } finally {
        process.env.GAS_API_KEY = saved;
    }
    assert.deepEqual([...a.calls, ...b.calls, ...c.calls, ...d.calls], []);
});

test('valid lookup forwards once to GAS with the key and ONLY the verified phone', async () => {
    for (const action of LOOKUP_ACTIONS) {
        for (const phone of ['5550100001', '']) {
            const { res, out, calls } = await call({ ...LOOKUP, action, phone, name: 'Someone Else', extra: 'dropped' });
            assert.equal(res.status, 200, action);
            assert.equal(calls.length, 1);
            assert.equal(calls[0].url, 'https://gas.test/exec');
            assert.deepEqual(calls[0].body, {
                action,
                phone: '5550100001',
                verifiedTelegramPhone: true,
                source: 'telegram_mini_app',
                telegramUserId: String(ME),
                telegramUsername: 'test_user',
                apiKey: FAKE_GAS_KEY,
            });
            assert.ok(!JSON.stringify(out).includes(FAKE_GAS_KEY));
        }
    }
});

test('valid write actions forward once with the key; verified identity replaces client claims', async () => {
    for (const action of WRITE_ACTIONS) {
        const body = { action, initData: initData(), telegramUserId: String(OTHER), telegramUsername: 'spoofed', apiKey: 'client-key', base64Data: 'AAAA', name: 'Test Person' };
        const { res, calls } = await call(body);
        assert.equal(res.status, 200, action);
        assert.equal(calls.length, 1, action);
        const fwd = calls[0].body;
        assert.equal(fwd.action, action);
        assert.equal(fwd.apiKey, FAKE_GAS_KEY);
        assert.equal(fwd.telegramUserId, String(ME));
        assert.equal(fwd.telegramUsername, 'test_user');
        assert.equal(fwd.initData, undefined);
        assert.equal(fwd.name, 'Test Person');
    }
});

test('anonymous client update forwards without the Telegram user id', async () => {
    const { calls } = await call({ action: 'telegram_client_update', initData: initData(), isAnonymous: true, updateType: 'anonymous_tip' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.telegramUserId, '');
    assert.equal(calls[0].body.telegramUsername, '');
});

test('per-user lookup rate limit: 11th lookup in 10 minutes → 429 with no fetch', async () => {
    const rateStore = memoryStore();
    let fetches = 0;
    for (let i = 0; i < 10; i++) {
        const { res, calls } = await call(LOOKUP, { rateStore });
        assert.equal(res.status, 200);
        fetches += calls.length;
    }
    const { res, calls } = await call(LOOKUP, { rateStore });
    assert.equal(res.status, 429);
    assert.deepEqual(calls, []);
    assert.equal(fetches, 10);
});

test('retired /api/status returns 410 with zero fetches', async () => {
    const realFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = async () => { n++; return new Response('{}'); };
    try {
        const res = await statusProxy(new Request('https://example.test/api/status', { method: 'POST', body: JSON.stringify({ phone: OTHER_PHONE }) }));
        assert.equal(res.status, 410);
        assert.equal(n, 0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('no Mini App page talks to the GAS URL; pages use /api/miniapp', () => {
    const ROOT = new URL('../', import.meta.url);
    const skip = new Set(['node_modules', '.git', 'netlify', 'tests', 'docs', '.github', '.agent']);
    const offenders = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            if (skip.has(name)) continue;
            const url = new URL(name, dir);
            if (statSync(url).isDirectory()) walk(new URL(name + '/', dir));
            else if (/\.(js|html)$/.test(name)) {
                const src = readFileSync(url, 'utf8');
                if (/script\.google\.com|SHAMROCK_GAS_ENDPOINT|GAS_ENDPOINT/.test(src)) offenders.push(url.pathname.split(ROOT.pathname)[1]);
            }
        }
    };
    walk(ROOT);
    assert.deepEqual(offenders, []);
    const brand = readFileSync(new URL('shared/brand.js', ROOT), 'utf8');
    assert.match(brand, /const SHAMROCK_MINIAPP_API = '\/api\/miniapp'/);
    for (const page of ['intake', 'payment', 'updates', 'status', 'documents', 'defendant']) {
        const src = readFileSync(new URL(page + '/app.js', ROOT), 'utf8');
        assert.match(src, /miniapp(Post|Lookup)\(/, page + ' uses the proxy');
    }
    for (const page of ['status', 'payment', 'documents', 'defendant']) {
        const src = readFileSync(new URL(page + '/app.js', ROOT), 'utf8');
        assert.match(src, /miniappLookup\(/, page + ' lookups need the verified phone');
    }
});
