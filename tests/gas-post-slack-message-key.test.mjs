// Every post_slack_message call to GAS must carry the GAS API key (env GAS_API_KEY, server-side).
// GAS will require data.apiKey on post_slack_message. Until that GAS change is pushed, the
// field is ignored, so sending it now is harmless.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../netlify/', import.meta.url);

function sourceFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const url = new URL(name, dir);
        if (statSync(url).isDirectory()) out.push(...sourceFiles(new URL(name + '/', dir)));
        else if (/\.(mjs|js|ts)$/.test(name)) out.push(url);
    }
    return out;
}

test('every post_slack_message body sends apiKey: gasApiKey()', () => {
    const callers = [];
    const missing = [];
    for (const url of sourceFiles(ROOT)) {
        const src = readFileSync(url, 'utf8');
        let i = src.indexOf("'post_slack_message'");
        while (i !== -1) {
            const rel = url.pathname.split('/netlify/')[1];
            callers.push(rel);
            const end = src.indexOf('}', i);
            const start = src.lastIndexOf('{', i);
            const body = src.slice(start, end);
            if (!/apiKey:\s*gasApiKey\(\)/.test(body)) missing.push(rel);
            i = src.indexOf("'post_slack_message'", i + 1);
        }
    }
    assert.deepEqual(missing, [], 'post_slack_message without the GAS API key');
    // Inventory guard: a new caller must be reviewed (and send the key).
    assert.deepEqual(callers.sort(), [
        'functions/checkin-geo-alert.mjs',
        'functions/compliance-digest.mjs',
        'functions/daily-briefing.mjs',
        'functions/sentiment-watchdog.mjs',
    ]);
});

test('checkin-geo-alert posts post_slack_message with the GAS API key from env', async () => {
    process.env.GAS_WEB_APP_URL = 'https://gas.test/exec';
    process.env.GAS_API_KEY = '  test-gas-key  ';
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response('{}', { status: 200 });
    };
    try {
        const { default: handler } = await import(new URL('functions/checkin-geo-alert.mjs', ROOT));
        // Jacksonville check-in, home county Lee: well over the 50-mile threshold.
        const req = new Request('https://example.test/api/checkin-geo-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: 30.3322, longitude: -81.6557, homeCounty: 'lee', caseNumber: 'TEST-1', defendantName: 'Test Person' }),
        });
        const res = await handler(req);
        const out = await res.json();
        assert.equal(out.alert, true);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, 'https://gas.test/exec');
        assert.equal(sent[0].body.action, 'post_slack_message');
        assert.equal(sent[0].body.apiKey, 'test-gas-key', 'trimmed GAS_API_KEY is sent server-side');
        assert.ok(!JSON.stringify(out).includes('test-gas-key'), 'key never returned to the caller');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('compliance-digest (flag COMPLIANCE_DIGEST_ENABLED=true) posts with the GAS API key; all calls mocked', async () => {
    const { default: OpenAI } = await import('openai');
    process.env.GAS_WEB_APP_URL = 'https://gas.test/exec';
    process.env.GAS_API_KEY = 'test-gas-key';
    process.env.COMPLIANCE_DIGEST_ENABLED = 'true';
    const sent = [];
    const realFetch = globalThis.fetch;
    const realCreate = OpenAI.Chat.Completions.prototype.create;
    globalThis.fetch = async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true, missed: [] }), { status: 200 });
    };
    OpenAI.Chat.Completions.prototype.create = async () => ({ choices: [{ message: { content: 'TEST DIGEST' } }] });
    try {
        const { default: handler } = await import(new URL('functions/compliance-digest.mjs', ROOT));
        const res = await handler(new Request('https://example.test/.netlify/functions/compliance-digest'));
        assert.equal(res.status, 200);
        assert.equal(sent.length, 2);
        assert.equal(sent[1].body.action, 'post_slack_message');
        assert.equal(sent[1].body.apiKey, 'test-gas-key');
        assert.ok(!(await res.text()).includes('test-gas-key'), 'key never returned to the caller');
    } finally {
        globalThis.fetch = realFetch;
        OpenAI.Chat.Completions.prototype.create = realCreate;
        delete process.env.COMPLIANCE_DIGEST_ENABLED;
    }
});
