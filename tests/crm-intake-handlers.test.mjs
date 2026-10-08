import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GAS_WEB_APP_URL = 'https://gas.example.test/exec';
process.env.GAS_API_KEY = 'test-gas-key';
process.env.SHANNON_LEADS_URL = 'https://leads.example.test';

const { default: crmIntake } = await import('../netlify/functions/crm-intake.mjs');
const { default: notifyBondsman } = await import('../netlify/functions/notify-bondsman.mjs');

function jsonRequest(url, body) {
    return new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
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
        assert.equal(mock.calls[1].body.intakeId, 'TG-ABC');
        assert.equal(mock.calls[1].body.id_image_b64, undefined);
    } finally {
        mock.restore();
    }
});

test('notify-bondsman submits shannon_voice and does not call GAS when CRM accepts', async () => {
    const mock = mockFetch([
        {
            match: '/api/intake/submit',
            respond: () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, intake_id: 'SH-1', source: 'shannon_voice' }),
            }),
        },
    ]);
    try {
        const response = await notifyBondsman(jsonRequest('https://app.example/api/notify-bondsman', {
            caller_name: 'Amy Roe',
            caller_phone: '2395550101',
            defendant_name: 'Bob Roe',
            county: 'Lee',
        }));
        const data = await response.json();
        assert.equal(data.via, 'crm');
        assert.equal(data.intake_id, 'SH-1');
        assert.equal(mock.calls.length, 1);
        assert.equal(mock.calls[0].body.source, 'shannon_voice');
        assert.equal(mock.calls[0].body.bondAmount, undefined);
        assert.equal(mock.calls[0].body.bookingNumber, undefined);
        assert.equal(mock.calls[0].body.IndName, 'Amy Roe');
        assert.equal(mock.calls[0].body.DefCounty, 'Lee');
    } finally {
        mock.restore();
    }
});
