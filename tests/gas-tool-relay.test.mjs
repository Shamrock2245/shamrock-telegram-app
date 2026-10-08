// /api/gas-tool: phase-1 ElevenLabs tools → GAS.
// Refusals (no/wrong bearer, env unset, non-allowlisted tool, caller ?secret=,
// caller GAS URL) make ZERO fetches.
// A valid request forwards once; ?secret= is added only when ELEVENLABS_TOOL_SECRET is set.
// Fixtures are fake. fetch is mocked. This file never calls production GAS.
// send_payment_link, email_paperwork_to_indemnitor, send_paperwork, and
// transfer_to_bondsman are allowlist membership checks only — call() refuses
// to invoke them, even against the mock.
import assert from 'node:assert/strict';
import test from 'node:test';

const FAKE_BEARER = 'test-el-tool-relay-secret-not-real';
const FAKE_TOOL_SECRET = 'test-elevenlabs-tool-secret-not-real';
const FAKE_GAS = 'https://gas.test/exec';
const HARMLESS_BODY = '{"bond_amount":5000}';

const PHASE_1 = [
    'lookup_defendant',
    'check_inmate_status',
    'calculate_premium',
    'create_intake',
    'send_payment_link',
    'check_client_account',
    'save_paperwork_answers',
    'email_paperwork_to_indemnitor',
    'request_id_photo',
    'check_id_upload',
    'schedule_office_visit',
    'transfer_to_bondsman',
    'send_paperwork',
];

const NOT_ON_THIS_RELAY = ['send_sms', 'schedule_callback', 'check_caller_history', 'notify_bondsman'];

// Never pass these to the handler. A mock bug must not be able to fire them.
const NEVER_INVOKE = new Set([
    'send_payment_link',
    'email_paperwork_to_indemnitor',
    'send_paperwork',
    'transfer_to_bondsman',
]);

process.env.GAS_WEB_APP_URL = FAKE_GAS;
process.env.EL_TOOL_RELAY_SECRET = FAKE_BEARER;
process.env.ELEVENLABS_TOOL_SECRET = FAKE_TOOL_SECRET;

const { createGasToolHandler, ALLOWED_TOOLS, MAX_BODY_BYTES, config } = await import('../netlify/functions/gas-tool.mjs');

async function call({
    tool = 'calculate_premium',
    auth = 'Bearer ' + FAKE_BEARER,
    body = HARMLESS_BODY,
    env = {},
    method = 'POST',
    extra = [],
    url = '',
} = {}) {
    if (NEVER_INVOKE.has(tool)) {
        throw new Error('refusing to invoke ' + tool);
    }
    const prev = {
        EL_TOOL_RELAY_SECRET: process.env.EL_TOOL_RELAY_SECRET,
        ELEVENLABS_TOOL_SECRET: process.env.ELEVENLABS_TOOL_SECRET,
        GAS_WEB_APP_URL: process.env.GAS_WEB_APP_URL,
    };
    for (const [k, v] of Object.entries(env)) {
        if (v === null) delete process.env[k];
        else process.env[k] = v;
    }
    const calls = [];
    const fetchImpl = async (target, init) => {
        calls.push({
            url: String(target),
            method: init && init.method,
            body: init && init.body,
            headers: init && init.headers,
            redirect: init && init.redirect,
        });
        return new Response(JSON.stringify({ status: 'ok', premium: 500 }), { status: 200 });
    };
    const handler = createGasToolHandler({ fetchImpl });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        calls.push({ url: String(args[0]), global: true });
        throw new Error('unexpected global fetch');
    };
    try {
        const built = url || (() => {
            const u = new URL('https://example.test/api/gas-tool');
            if (tool != null) u.searchParams.set('tool', tool);
            for (const [k, v] of extra) u.searchParams.append(k, v);
            return u.toString();
        })();
        const res = await handler(new Request(built, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(auth != null ? { Authorization: auth } : {}),
            },
            ...(method === 'POST' ? { body } : {}),
        }));
        return { res, out: await res.json().catch(() => null), calls };
    } finally {
        globalThis.fetch = realFetch;
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

test('config path is POST /api/gas-tool', () => {
    assert.equal(config.path, '/api/gas-tool');
});

test('allowlist is the phase-1 thirteen tools', () => {
    assert.deepEqual([...ALLOWED_TOOLS].sort(), [...PHASE_1].sort());
    assert.equal(ALLOWED_TOOLS.length, 13);
});

test('send_sms, schedule_callback, check_caller_history, notify_bondsman are not allowlisted', () => {
    for (const name of NOT_ON_THIS_RELAY) {
        assert.equal(ALLOWED_TOOLS.includes(name), false, name);
    }
});

test('unauthenticated → 401, zero fetches', async () => {
    const { res, out, calls } = await call({ auth: null });
    assert.equal(res.status, 401);
    assert.equal(out.error, 'unauthorized');
    assert.equal(calls.length, 0);
});

test('wrong bearer → 401, zero fetches', async () => {
    const { res, out, calls } = await call({ auth: 'Bearer wrong-secret' });
    assert.equal(res.status, 401);
    assert.equal(out.error, 'unauthorized');
    assert.equal(calls.length, 0);
});

test('wrong bearer plus inbound ?secret= → 401, zero fetches', async () => {
    const { res, calls } = await call({
        auth: 'Bearer wrong-secret',
        extra: [['secret', FAKE_TOOL_SECRET]],
    });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
});

test('EL_TOOL_RELAY_SECRET unset → 503 relay_misconfigured, zero fetches', async () => {
    const { res, out, calls } = await call({ env: { EL_TOOL_RELAY_SECRET: null } });
    assert.equal(res.status, 503);
    assert.equal(out.error, 'relay_misconfigured');
    assert.equal(calls.length, 0);
});

test('EL_TOOL_RELAY_SECRET blank → 503, zero fetches', async () => {
    const { res, out, calls } = await call({ env: { EL_TOOL_RELAY_SECRET: '   ' } });
    assert.equal(res.status, 503);
    assert.equal(out.error, 'relay_misconfigured');
    assert.equal(calls.length, 0);
});

test('unlisted tool → 400 tool_not_allowed, zero fetches', async () => {
    const { res, out, calls } = await call({ tool: 'not_a_real_tool' });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'tool_not_allowed');
    assert.equal(calls.length, 0);
});

test('send_sms is not on this relay → 400, zero fetches', async () => {
    const { res, out, calls } = await call({ tool: 'send_sms' });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'tool_not_allowed');
    assert.equal(calls.length, 0);
});

test('schedule_callback, check_caller_history, notify_bondsman → 400, zero fetches', async () => {
    for (const tool of ['schedule_callback', 'check_caller_history', 'notify_bondsman']) {
        const { res, out, calls } = await call({ tool });
        assert.equal(res.status, 400, tool);
        assert.equal(out.error, 'tool_not_allowed', tool);
        assert.equal(calls.length, 0, tool);
    }
});

test('missing tool → 400, zero fetches', async () => {
    const { res, calls } = await call({ tool: null });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
});

test('inbound ?secret= rejected before any fetch', async () => {
    const { res, out, calls } = await call({ extra: [['secret', 'caller-supplied']] });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'inbound_secret_rejected');
    assert.equal(calls.length, 0);
});

test('inbound ?secret= rejected even when the value matches the outbound env', async () => {
    const { res, out, calls } = await call({ extra: [['secret', FAKE_TOOL_SECRET]] });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'inbound_secret_rejected');
    assert.equal(calls.length, 0);
});

test('inbound ?SECRET= (any case) rejected, zero fetches', async () => {
    const { res, out, calls } = await call({ extra: [['SECRET', 'nope']] });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'inbound_secret_rejected');
    assert.equal(calls.length, 0);
});

test('GAS URL in the query is rejected, zero fetches', async () => {
    const { res, out, calls } = await call({
        extra: [['next', 'https://script.google.com/macros/s/abc/exec']],
    });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'gas_url_rejected');
    assert.equal(calls.length, 0);
});

test('URL-encoded GAS URL in the query is rejected, zero fetches', async () => {
    const { res, out, calls } = await call({
        url: 'https://example.test/api/gas-tool?tool=calculate_premium&next=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2Fabc%2Fexec',
    });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'gas_url_rejected');
    assert.equal(calls.length, 0);
});

test('double-encoded GAS URL in the query is rejected, zero fetches', async () => {
    const { res, out, calls } = await call({
        url: 'https://example.test/api/gas-tool?tool=calculate_premium&next=https%253A%252F%252Fscript%252Egoogle%252Ecom%252Fmacros',
    });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'gas_url_rejected');
    assert.equal(calls.length, 0);
});

test('GAS URL in the JSON body is rejected, zero fetches', async () => {
    const { res, out, calls } = await call({
        body: JSON.stringify({ note: 'https://script.google.com/macros/s/abc/exec?secret=hidden' }),
    });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'gas_url_rejected');
    assert.equal(calls.length, 0);
});

test('script.googleusercontent.com in the body is rejected, zero fetches', async () => {
    const { res, out, calls } = await call({
        body: JSON.stringify({ hops: ['https://script.googleusercontent.com/macros/echo'] }),
    });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'gas_url_rejected');
    assert.equal(calls.length, 0);
});

test('unicode-escaped GAS host in JSON is rejected, zero fetches', async () => {
    const body = '{"note":"https://script.google\\u002ecom/macros/s/abc/exec"}';
    const { res, out, calls } = await call({ body });
    assert.equal(res.status, 400);
    assert.equal(out.error, 'gas_url_rejected');
    assert.equal(calls.length, 0);
});

test('a non-GAS URL in the body is forwarded once and does not replace the GAS host', async () => {
    const body = JSON.stringify({ note: 'https://example.com/rates' });
    const { res, calls } = await call({ body });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].global, undefined);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, FAKE_GAS);
    assert.equal(calls[0].body, body);
});

test('happy path appends ?secret= only from ELEVENLABS_TOOL_SECRET', async () => {
    const { res, out, calls } = await call();
    assert.equal(res.status, 200);
    assert.equal(out.status, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].global, undefined);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].redirect, 'follow');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(calls[0].body, HARMLESS_BODY);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, FAKE_GAS);
    assert.equal(u.searchParams.get('source'), 'elevenlabs_tool');
    assert.equal(u.searchParams.get('tool'), 'calculate_premium');
    assert.equal(u.searchParams.get('secret'), FAKE_TOOL_SECRET);
    assert.deepEqual([...u.searchParams.keys()].sort(), ['secret', 'source', 'tool']);
});

test('ELEVENLABS_TOOL_SECRET unset → still forwards once, without secret param', async () => {
    const { res, out, calls } = await call({ env: { ELEVENLABS_TOOL_SECRET: null } });
    assert.equal(res.status, 200);
    assert.equal(out.status, 'ok');
    assert.equal(calls.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, FAKE_GAS);
    assert.equal(u.searchParams.get('source'), 'elevenlabs_tool');
    assert.equal(u.searchParams.get('tool'), 'calculate_premium');
    assert.equal(u.searchParams.has('secret'), false);
    assert.deepEqual([...u.searchParams.keys()].sort(), ['source', 'tool']);
});

test('blank ELEVENLABS_TOOL_SECRET → forwards without secret param', async () => {
    const { res, calls } = await call({ env: { ELEVENLABS_TOOL_SECRET: '  ' } });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).searchParams.has('secret'), false);
});

test('caller query params other than tool are not copied onto the GAS URL', async () => {
    const { res, calls } = await call({ extra: [['extra', '1']] });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get('extra'), null);
    assert.equal(u.searchParams.get('tool'), 'calculate_premium');
    assert.equal(u.searchParams.get('secret'), FAKE_TOOL_SECRET);
});

test('body over 64KB → 413, zero fetches', async () => {
    const { res, out, calls } = await call({ body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    assert.equal(res.status, 413);
    assert.equal(out.error, 'body_too_large');
    assert.equal(calls.length, 0);
});

test('GET → 405, zero fetches', async () => {
    const { res, calls } = await call({ method: 'GET' });
    assert.equal(res.status, 405);
    assert.equal(calls.length, 0);
});

test('GAS_WEB_APP_URL unset is fail-closed in source', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../netlify/functions/gas-tool.mjs', import.meta.url), 'utf8'));
    assert.match(src, /MISSING_GAS_WEB_APP_URL/);
    assert.match(src, /relay_misconfigured/);
});

test('gas-tool.mjs never console.logs a URL, body, or secret value', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../netlify/functions/gas-tool.mjs', import.meta.url), 'utf8'));
    const callsites = src.match(/console\.(log|info|warn|error)\([^)]*\)/g) || [];
    assert.ok(callsites.length >= 1);
    for (const site of callsites) {
        assert.equal(/gasUrl|toolSecret|rawBody|secret|body|GAS_ENDPOINT|url/.test(site), false, site);
    }
});

test('runtime logs are tool name and status only', async () => {
    const lines = [];
    const orig = {
        info: console.info,
        error: console.error,
        log: console.log,
        warn: console.warn,
    };
    for (const key of Object.keys(orig)) {
        console[key] = (...args) => {
            lines.push(args.map((part) => String(part)).join(' '));
        };
    }
    try {
        const happy = await call();
        const denied = await call({ tool: 'send_sms' });
        const smuggled = await call({
            body: JSON.stringify({ note: 'https://script.google.com/macros/s/abc/exec?secret=hidden' }),
        });
        assert.equal(happy.res.status, 200);
        assert.equal(denied.res.status, 400);
        assert.equal(smuggled.res.status, 400);
    } finally {
        Object.assign(console, orig);
    }
    assert.deepEqual(lines, [
        '[gas-tool] tool=calculate_premium status=200',
        '[gas-tool] tool=- status=400',
        '[gas-tool] tool=calculate_premium status=400',
    ]);
    const joined = lines.join('\n');
    assert.equal(joined.includes(FAKE_TOOL_SECRET), false);
    assert.equal(joined.includes(FAKE_BEARER), false);
    assert.equal(joined.includes('gas.test'), false);
    assert.equal(joined.includes('script.google'), false);
    assert.equal(joined.includes('bond_amount'), false);
    assert.equal(joined.includes('hidden'), false);
});
