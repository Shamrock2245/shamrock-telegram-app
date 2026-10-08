import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

process.env.GAS_WEB_APP_URL = 'https://gas.example.test/exec';
process.env.GAS_API_KEY = 'test-gas-key';
process.env.SHANNON_LEADS_URL = 'https://leads.example.test';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

const { default: crmIntake } = await import('../netlify/functions/crm-intake.mjs');
const { default: notifyBondsman } = await import('../netlify/functions/notify-bondsman.mjs');
const { checkLimit } = await import('../netlify/functions/shared/rate-limiter.mjs');
const { validateTelegramInitData } = await import('../netlify/functions/shared/telegram-init-data.mjs');

function signInitData(userId = 4242) {
    const fields = {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'AAE',
        user: JSON.stringify({ id: userId, username: 'jane' }),
    };
    const pairs = Object.keys(fields).sort().map((key) => key + '=' + fields[key]);
    const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
    const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const params = new URLSearchParams(fields);
    params.set('hash', hash);
    return params.toString();
}

function jsonRequest(url, body, extra) {
    const payload = Object.assign({ initData: signInitData() }, body || {});
    const request = new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (extra && extra.rateStore) request.__rateStore = extra.rateStore;
    return request;
}

function memoryStore() {
    const data = new Map();
    return {
        async get(key) { return data.has(key) ? data.get(key) : null; },
        async set(key, value) { data.set(key, value); },
    };
}

function mockFetch(routes) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        const href = String(url);
        let parsed = null;
        if (init && init.body) {
            try { parsed = JSON.parse(init.body); } catch { parsed = init.body; }
        }
        calls.push({ url: href, body: parsed, key: init && init.headers ? init.headers['X-API-Key'] : '' });
        if (href.includes('twilio.com') || href.includes('api.telegram.org')) {
            throw new Error('live provider call');
        }
        for (const route of routes) {
            if (href.includes(route.match)) return route.respond(href, parsed);
        }
        throw new Error('unexpected fetch ' + href);
    };
    return {
        calls,
        restore() { globalThis.fetch = original; },
    };
}

test('mini-app handler scans the ID, submits telegram_miniapp, and skips GAS when CRM accepts', async () => {
    const mock = mockFetch([
        {
            match: '/api/id/scan-ocr',
            respond: () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, extracted: { full_name: 'JANE PUBLIC', dob: '1991-02-02' } }),
            }),
        },
        {
            match: '/api/intake/submit',
            respond: () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, intake_id: 'TG-ABC', source: 'telegram_miniapp' }),
            }),
        },
    ]);
    try {
        const response = await crmIntake(jsonRequest('https://app.example/api/crm-intake', {
            source: 'telegram_miniapp',
            intakeId: 'TG-ABC',
            IndName: 'Jane Public',
            IndPhone: '2395550101',
            IndEmail: 'jane@example.com',
            IndAddress: '99 Typed St',
            DefName: 'Bob Public',
            DefBondAmount: '',
            id_image_b64: 'abc',
            id_filename: 'id.jpg',
        }));
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.via, 'crm');
        assert.equal(data.intake_id, 'TG-ABC');
        assert.equal(mock.calls.length, 2);
        assert.equal(mock.calls[0].body.booking_number, undefined);
        assert.equal(mock.calls[1].body.source, 'telegram_miniapp');
        assert.equal(mock.calls[1].body.IndDOB, '1991-02-02');
        assert.equal(mock.calls[1].body.bondAmount, undefined);
        assert.equal(mock.calls[1].body.id_image_b64, undefined);
        assert.equal(mock.calls.some((call) => call.url.includes('gas.example')), false);
    } finally {
        mock.restore();
    }
});

test('mini-app handler falls back to GAS only after the CRM call fails', async () => {
    const mock = mockFetch([
        {
            match: '/api/intake/submit',
            respond: () => ({
                ok: false,
                status: 503,
                json: async () => ({ success: false, error: 'down' }),
            }),
        },
        {
            match: 'gas.example.test',
            respond: () => ({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ success: true, intakeId: 'TG-ABC' }),
            }),
        },
    ]);
    try {
        const response = await crmIntake(jsonRequest('https://app.example/api/crm-intake', {
            source: 'telegram_miniapp',
            intakeId: 'TG-ABC',
            IndName: 'Jane Public',
            IndPhone: '2395550101',
        }));
        const data = await response.json();
        assert.equal(data.via, 'gas_fallback');
        assert.equal(mock.calls[0].url.includes('/api/intake/submit'), true);
        assert.equal(mock.calls[1].url.includes('gas.example.test'), true);
        assert.equal(mock.calls[1].body.action, 'telegram_mini_app_intake');
        assert.equal(mock.calls[1].body.source, 'telegram_mini_app');
        assert.equal(mock.calls[1].body.surety_id, 'osi');
        assert.equal(mock.calls[1].body.intakeId, 'TG-ABC');
        assert.equal(mock.calls[1].body.id_image_b64, undefined);
        assert.equal(mock.calls[1].body.initData, undefined);
    } finally {
        mock.restore();
    }
});

test('notify-bondsman submits shannon_voice and still forwards the callback to GAS', async () => {
    const mock = mockFetch([
        {
            match: '/api/intake/submit',
            respond: () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, intake_id: 'SH-2395550101-BOB-ROE', source: 'shannon_voice' }),
            }),
        },
        {
            match: 'gas.example.test',
            respond: () => ({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ success: true, status: 'notified' }),
            }),
        },
    ]);
    try {
        const response = await notifyBondsman(jsonRequest('https://app.example/api/notify-bondsman', {
            caller_name: 'Amy Roe',
            caller_phone: '2395550101',
            defendant_name: 'Bob Roe',
            county: 'Lee',
            case_reference: 'SH-2395550101-BOB-ROE',
            preferred_time: '3pm',
        }));
        const data = await response.json();
        assert.equal(data.via, 'crm');
        assert.equal(data.intake_id, 'SH-2395550101-BOB-ROE');
        assert.equal(data.case_reference, 'SH-2395550101-BOB-ROE');
        assert.equal(mock.calls.length, 2);
        assert.equal(mock.calls[0].body.source, 'shannon_voice');
        assert.equal(mock.calls[0].body.intakeId, 'SH-2395550101-BOB-ROE');
        assert.equal(mock.calls[0].body.bondAmount, undefined);
        assert.equal(mock.calls[0].body.bookingNumber, undefined);
        assert.equal(mock.calls[0].body.IndName, 'Amy Roe');
        assert.equal(mock.calls[0].body.DefCounty, 'Lee');
        const gas = new URL(mock.calls[1].url);
        assert.equal(gas.searchParams.get('source'), 'notify_bondsman');
        const forwarded = JSON.parse(decodeURIComponent(gas.searchParams.get('data')));
        assert.equal(forwarded.case_reference, 'SH-2395550101-BOB-ROE');
        assert.equal(forwarded.preferred_time, '3pm');
        assert.equal(forwarded.caller_phone, '2395550101');
    } finally {
        mock.restore();
    }
});

test('crm-intake rejects a missing or bad initData and does not call the CRM', async () => {
    const mock = mockFetch([]);
    try {
        const missing = await crmIntake(new Request('https://app.example/api/crm-intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'telegram_miniapp', IndName: 'Jane', DefName: 'Bob' }),
        }));
        assert.equal(missing.status, 401);
        const bad = await crmIntake(jsonRequest('https://app.example/api/crm-intake', {
            initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef',
            IndName: 'Jane',
        }));
        assert.equal(bad.status, 401);
        assert.equal(mock.calls.length, 0);
        assert.equal(validateTelegramInitData('', process.env.TELEGRAM_BOT_TOKEN).ok, false);
    } finally {
        mock.restore();
    }
});

test('crm-intake rate limit is 20 requests per 10 minutes per Telegram user', async () => {
    const store = memoryStore();
    const req = new Request('https://app.example/api/crm-intake', { method: 'POST' });
    let last;
    for (let i = 0; i < 21; i++) {
        last = await checkLimit(req, 'crm-intake', 20, {
            windowMs: 10 * 60 * 1000,
            subject: 'tg:4242',
            store,
        });
    }
    assert.equal(last.allowed, false);
    const otherUser = await checkLimit(req, 'crm-intake', 20, {
        windowMs: 10 * 60 * 1000,
        subject: 'tg:999',
        store,
    });
    assert.equal(otherUser.allowed, true);

    const blocked = await crmIntake(jsonRequest('https://app.example/api/crm-intake', {
        source: 'telegram_miniapp',
        IndName: 'Jane',
    }, { rateStore: {
        async get() { return JSON.stringify({ count: 20, windowStart: Date.now() }); },
        async set() {},
    } }));
    assert.equal(blocked.status, 429);
});
