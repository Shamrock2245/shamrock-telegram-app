import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

delete process.env.GAS_WEB_APP_URL;
delete process.env.GAS_ENDPOINT;
process.env.GAS_API_KEY = 'test-gas-key';
process.env.SHANNON_LEADS_URL = 'https://leads.example.test';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

const { default: crmIntake } = await import('../netlify/functions/crm-intake.mjs');

function signInitData(token = process.env.TELEGRAM_BOT_TOKEN) {
    const fields = {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'AAE',
        user: JSON.stringify({ id: 4242, username: 'jane' }),
    };
    const pairs = Object.keys(fields).sort().map((key) => key + '=' + fields[key]);
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const params = new URLSearchParams(fields);
    params.set('hash', hash);
    return params.toString();
}

test('a CRM miss returns crm_failed and does not fetch GAS', async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).includes('/api/intake/submit')) {
            return { ok: false, status: 503, json: async () => ({ success: false, error: 'down' }) };
        }
        throw new Error('unexpected fetch ' + url);
    };
    try {
        const response = await crmIntake(new Request('https://app.example/api/crm-intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                initData: signInitData(),
                source: 'telegram_miniapp',
                intakeId: 'TG-ABC',
                IndName: 'Jane Public',
                DefName: 'Bob Public',
            }),
        }));
        const data = await response.json();
        assert.equal(response.status, 502);
        assert.equal(data.success, false);
        assert.equal(data.error, 'crm_failed');
        assert.equal(data.via, 'crm_failed');
        assert.equal(calls.length, 1);
        assert.equal(calls.some((url) => url.includes('gas')), false);
    } finally {
        globalThis.fetch = original;
    }
});

test('initData fails closed when the bot token is missing', async () => {
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    const initData = signInitData('test-bot-token');
    delete process.env.TELEGRAM_BOT_TOKEN;
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error('should not fetch'); };
    try {
        const response = await crmIntake(new Request('https://app.example/api/crm-intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                initData,
                source: 'telegram_miniapp',
                IndName: 'Jane',
            }),
        }));
        assert.equal(response.status, 401);
        assert.equal(called, false);
    } finally {
        process.env.TELEGRAM_BOT_TOKEN = previous;
        globalThis.fetch = original;
    }
});
