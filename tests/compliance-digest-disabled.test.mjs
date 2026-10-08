// compliance-digest is unscheduled, so it is a plain URL anyone can call. It must return
// 410 'disabled' before ANY outbound call (GAS, OpenAI, Slack-via-GAS) unless
// COMPLIANCE_DIGEST_ENABLED === 'true'. All network paths are stubbed: no real calls.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import test from 'node:test';
import OpenAI from 'openai';

const MODULE = new URL('../netlify/functions/compliance-digest.mjs', import.meta.url);

function stubNetwork() {
    const calls = [];
    const real = {
        fetch: globalThis.fetch,
        httpRequest: http.request,
        httpsRequest: https.request,
        create: OpenAI.Chat.Completions.prototype.create,
    };
    globalThis.fetch = async (url, init) => {
        calls.push({ kind: 'fetch', url: String(url), body: init && init.body });
        return new Response('not json', { status: 200 });
    };
    http.request = (...args) => { calls.push({ kind: 'http.request' }); throw new Error('network disabled in tests'); };
    https.request = (...args) => { calls.push({ kind: 'https.request' }); throw new Error('network disabled in tests'); };
    OpenAI.Chat.Completions.prototype.create = async () => {
        calls.push({ kind: 'openai' });
        throw new Error('OpenAI disabled in tests');
    };
    return {
        calls,
        restore() {
            globalThis.fetch = real.fetch;
            http.request = real.httpRequest;
            https.request = real.httpsRequest;
            OpenAI.Chat.Completions.prototype.create = real.create;
        },
    };
}

async function callWithFlag(flag, method = 'GET') {
    const prev = process.env.COMPLIANCE_DIGEST_ENABLED;
    if (flag === undefined) delete process.env.COMPLIANCE_DIGEST_ENABLED;
    else process.env.COMPLIANCE_DIGEST_ENABLED = flag;
    process.env.GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || 'https://gas.test/exec';
    const net = stubNetwork();
    try {
        const { default: handler } = await import(MODULE);
        const req = new Request('https://example.test/.netlify/functions/compliance-digest', { method });
        const res = await handler(req);
        return { res, text: await res.text(), calls: net.calls };
    } finally {
        net.restore();
        if (prev === undefined) delete process.env.COMPLIANCE_DIGEST_ENABLED;
        else process.env.COMPLIANCE_DIGEST_ENABLED = prev;
    }
}

test('plain request with COMPLIANCE_DIGEST_ENABLED unset: 410 disabled, zero outbound calls', async () => {
    for (const method of ['GET', 'POST']) {
        const { res, text, calls } = await callWithFlag(undefined, method);
        assert.ok([404, 410].includes(res.status), `${method}: expected 410/404, got ${res.status}`);
        assert.match(text, /disabled/i);
        assert.deepEqual(calls, [], `${method}: no fetch, http(s) or OpenAI call while disabled`);
    }
});

test('only the exact string "true" enables it; other values stay disabled with zero calls', async () => {
    for (const flag of ['', 'false', '1', 'TRUE', 'True', 'yes', ' true']) {
        const { res, text, calls } = await callWithFlag(flag);
        assert.equal(res.status, 410, `flag ${JSON.stringify(flag)}`);
        assert.match(text, /disabled/i);
        assert.deepEqual(calls, [], `flag ${JSON.stringify(flag)} must not make outbound calls`);
    }
});

test('COMPLIANCE_DIGEST_ENABLED === "true" reaches the GAS fetch (mocked, no real call)', async () => {
    const { res, text, calls } = await callWithFlag('true');
    // The mocked GAS reply is not JSON, so the handler stops before OpenAI and Slack.
    assert.equal(res.status, 200);
    assert.doesNotMatch(text, /disabled/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'fetch');
    assert.equal(JSON.parse(calls[0].body).action, 'get_compliance_report');
});
