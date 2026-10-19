// Call-site smoke test for the OpenAI SDK and @netlify/blobs.
// Modeled so the same file passes on openai 4.x + @netlify/blobs 7.x (main)
// and on openai 7.34.0 + @netlify/blobs 11.1.4. global fetch is mocked.
// OpenAI 4.x would otherwise dial out through node-fetch, so that specifier is
// redirected at the mock and raw http(s).request is blocked.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { register } from 'node:module';
import test from 'node:test';

function blocked(kind) {
    return function blockedRequest(...args) {
        const input = args[0];
        const options = args[1];
        const host = typeof input === 'string'
            ? input
            : (input && (input.host || input.hostname)) || (options && (options.host || options.hostname)) || '';
        throw new Error('blocked ' + kind + ' ' + host);
    };
}
http.request = blocked('http.request');
https.request = blocked('https.request');
http.get = blocked('http.get');
https.get = blocked('https.get');

const R = new URL('../netlify/functions/', import.meta.url);
process.env.OPENAI_API_KEY = 'test-key';
process.env.GROK_API_KEY = 'test-grok';
process.env.GAS_WEB_APP_URL = 'https://gas.invalid/exec';
// Netlify Blobs runtime context (fake) so getStore('rate-limits') resolves to our mocked fetch.
// Both @netlify/blobs 7 and 11 read NETLIFY_BLOBS_CONTEXT (base64 JSON with siteID, token, edgeURL).
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({
    siteID: 'site-test',
    token: 'tok-test',
    edgeURL: 'https://blobs.invalid',
})).toString('base64');

register(new URL('./support/redirect-node-fetch-hook.mjs', import.meta.url), {
    parentURL: import.meta.url,
});

const calls = [];
const blob = new Map();
globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || input.method || 'GET').toUpperCase();
    calls.push({ url, method });
    if (url.includes('blobs.invalid')) {
        const key = decodeURIComponent(new URL(url).pathname);
        if (method === 'GET') return blob.has(key) ? new Response(blob.get(key)) : new Response(null, { status: 404 });
        if (method === 'PUT') {
            const b = init.body;
            blob.set(key, typeof b === 'string' ? b : await new Response(b).text());
            return new Response(null, { status: 200 });
        }
    }
    if (url.includes('/chat/completions')) {
        const raw = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
        const body = JSON.parse(raw);
        const headers = init.headers;
        calls.at(-1).body = body;
        calls.at(-1).auth = headers instanceof Headers
            ? headers.get('authorization')
            : (typeof headers?.get === 'function'
                ? headers.get('authorization')
                : (headers?.Authorization || headers?.authorization));
        if (body.stream) {
            const sse = ['Hel', 'lo'].map((c) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { content: c }, finish_reason: null }] })}\n\n`).join('') + 'data: [DONE]\n\n';
            return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return Response.json({
            id: 'x',
            object: 'chat.completion',
            created: 1,
            model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: '{"score":42,"summary":"ok","translated":"hola"}' }, finish_reason: 'stop' }],
        });
    }
    throw new Error('unexpected fetch ' + url);
};

const post = (b) => new Request('https://x.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(b),
});

test('getOpenAI and getGrok (x.ai baseURL)', async () => {
    const { getOpenAI, getGrok } = await import(new URL('shared/ai-client.mjs', R));
    const openai = getOpenAI();
    const grok = getGrok();
    assert.equal(openai.baseURL, 'https://api.openai.com/v1');
    assert.equal(grok.baseURL, 'https://api.x.ai/v1');
});

test('translate (openai non-stream via real SDK)', async () => {
    const { default: h } = await import(new URL('translate.mjs', R));
    const r = await h(post({ text: 'hello', targetLang: 'es' }));
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.translated);
    const c = calls.find((call) => call.url.includes('api.openai.com/v1/chat/completions'));
    assert.ok(c, 'hit openai endpoint');
    assert.equal(c.body.model, 'gpt-4o-mini');
    assert.match(String(c.auth), /Bearer test-key/);
    assert.ok(calls.some((call) => call.url.includes('blobs.invalid') && call.method === 'PUT'), 'rate limiter wrote blob via @netlify/blobs');
});

test('ai-concierge streaming', async () => {
    const { default: h } = await import(new URL('ai-concierge.mjs', R));
    const r = await h(post({ messages: [{ role: 'user', content: 'hi' }] }));
    const t = await r.text();
    assert.match(t, /"content":"Hel"/);
    assert.match(t, /"content":"lo"/);
    assert.match(t, /\[DONE\]/);
    assert.doesNotMatch(t, /"error"/);
});

test('risk-score uses grok baseURL', async () => {
    const { default: h } = await import(new URL('risk-score.mjs', R));
    const r = await h(post({ defendant: { name: 'T' }, charges: ['x'], bondAmount: 1000, name: 'T' }));
    assert.ok(calls.some((call) => call.url.startsWith('https://api.x.ai/v1/chat/completions')), 'hit x.ai');
    assert.ok(r.status < 500, 'status ' + r.status + ' ' + await r.clone().text());
});

test('rate limiter counts within window', async () => {
    const { checkLimit } = await import(new URL('shared/rate-limiter.mjs', R));
    const req = post({});
    const a = await checkLimit(req, 'unit', 2);
    const b = await checkLimit(req, 'unit', 2);
    const c = await checkLimit(req, 'unit', 2);
    assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
    assert.equal(b.remaining, 0);
});
