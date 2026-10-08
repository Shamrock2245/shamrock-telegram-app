// GAS will require the API key (data.apiKey) on the risk-mitigation actions below. Every
// server-side caller must send apiKey: gasApiKey() (Netlify env GAS_API_KEY) first.
// All network calls are mocked: no real texts, Slack posts, GAS or OpenAI calls.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';
import OpenAI from 'openai';

const REPO = new URL('../', import.meta.url);
const FUNCTIONS = new URL('netlify/functions/', REPO);

// Must match the actions GAS gates with requireGasApiKey_ (portal backend-gas/Code.js).
const KEYED_ACTIONS = [
    'get_upcoming_court_dates',
    'send_court_reminders',
    'get_unacknowledged_reminders',
    'escalate_to_cosigner',
    'get_recent_client_messages',
    'flag_high_stress_case',
    'get_daily_stats',
    'get_forfeiture_cases',
    'post_slack_message',
    'schedule_court_date',
    'send_signing_link',
    'twilio_check_in',
    'telegram_get_signing_url',
    'telegram_document_status',
    'get_packet_manifest',
];

function walk(dir, skip = new Set(['node_modules', '.git', 'tests'])) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const url = new URL(name, dir);
        if (statSync(url).isDirectory()) out.push(...walk(new URL(name + '/', dir), skip));
        else if (/\.(mjs|js|ts|html)$/.test(name)) out.push(url);
    }
    return out;
}

function callSites(src, action) {
    const sites = [];
    for (const quote of ["'", '"', '`']) {
        const needle = quote + action + quote;
        let i = src.indexOf(needle);
        while (i !== -1) {
            sites.push(src.slice(src.lastIndexOf('{', i), src.indexOf('}', i)));
            i = src.indexOf(needle, i + 1);
        }
    }
    return sites;
}

test('every server-side call to a keyed GAS action sends apiKey: gasApiKey()', () => {
    const missing = [];
    const found = new Set();
    for (const url of walk(new URL('netlify/', REPO))) {
        const src = readFileSync(url, 'utf8');
        const rel = url.pathname.split('/netlify/')[1];
        for (const action of KEYED_ACTIONS) {
            for (const body of callSites(src, action)) {
                found.add(action);
                if (!/apiKey:\s*gasApiKey\(\)/.test(body)) missing.push(`${rel}: ${action}`);
            }
        }
    }
    assert.deepEqual(missing, []);
    // The 8 risk actions plus post_slack_message are called from scheduled functions today.
    for (const a of KEYED_ACTIONS.slice(0, 9)) assert.ok(found.has(a), `expected a caller for ${a}`);
});

test('no browser mini-app calls a keyed GAS action (it could not send the key)', () => {
    const offenders = [];
    for (const url of walk(REPO, new Set(['node_modules', '.git', 'tests', 'netlify', '.github']))) {
        const src = readFileSync(url, 'utf8');
        for (const action of KEYED_ACTIONS) {
            if (callSites(src, action).length) offenders.push(url.pathname.split(REPO.pathname)[1] + ': ' + action);
        }
    }
    assert.deepEqual(offenders, []);
});

async function runWithMocks(fnName, gasReplies, aiContent) {
    process.env.GAS_WEB_APP_URL = 'https://gas.test/exec';
    process.env.GAS_API_KEY = 'test-gas-key';
    const calls = [];
    const realFetch = globalThis.fetch;
    const realCreate = OpenAI.Chat.Completions.prototype.create;
    globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url: String(url), body });
        const reply = gasReplies[body.action] ?? { success: true };
        return new Response(JSON.stringify(reply), { status: 200 });
    };
    OpenAI.Chat.Completions.prototype.create = async () => {
        if (aiContent == null) throw new Error('OpenAI disabled in tests');
        return { choices: [{ message: { content: aiContent } }] };
    };
    try {
        const { default: handler } = await import(new URL(fnName + '.mjs', FUNCTIONS));
        const res = await handler(new Request('https://example.test/'));
        return { res, text: await res.text(), calls };
    } finally {
        globalThis.fetch = realFetch;
        OpenAI.Chat.Completions.prototype.create = realCreate;
    }
}

function assertAllKeyed(calls, expectedActions) {
    assert.deepEqual(calls.map((c) => c.body.action), expectedActions);
    for (const c of calls) {
        assert.equal(c.url, 'https://gas.test/exec');
        assert.equal(c.body.apiKey, 'test-gas-key', `${c.body.action} must carry the GAS API key`);
    }
}

const FAKE_PHONE = '+15550100000'; // 555-01xx: reserved fictional range

test('court-reminder sends the key on get_upcoming_court_dates and send_court_reminders', async () => {
    const { res, text, calls } = await runWithMocks('court-reminder', {
        get_upcoming_court_dates: { dates: [{ name: 'Test Person', phone: FAKE_PHONE, date: '2026-10-09', time: '9:00 AM', location: 'Test Court', caseNumber: 'TEST-1' }] },
    });
    assert.equal(res.status, 200);
    assertAllKeyed(calls, ['get_upcoming_court_dates', 'send_court_reminders']);
    assert.ok(!text.includes('test-gas-key'));
});

test('engagement-watchdog sends the key on get_unacknowledged_reminders and escalate_to_cosigner', async () => {
    const { res, calls } = await runWithMocks('engagement-watchdog', {
        get_unacknowledged_reminders: { cases: [{ caseNumber: 'TEST-1', defendantName: 'Test Person', cosignerPhone: FAKE_PHONE, hoursUntilCourt: 5 }] },
    });
    assert.equal(res.status, 200);
    assertAllKeyed(calls, ['get_unacknowledged_reminders', 'escalate_to_cosigner']);
});

test('sentiment-watchdog sends the key on get_recent_client_messages, post_slack_message and flag_high_stress_case', async () => {
    const { res, calls } = await runWithMocks(
        'sentiment-watchdog',
        { get_recent_client_messages: { messages: [{ caseNumber: 'TEST-1', name: 'Test Person', channel: 'sms', message: 'test message' }] } },
        JSON.stringify([{ sentiment: 'alarmed', stressIndicators: ['test'], explanation: 'test', flightRiskDelta: 1 }]),
    );
    assert.equal(res.status, 200);
    assertAllKeyed(calls, ['get_recent_client_messages', 'post_slack_message', 'flag_high_stress_case']);
});

test('daily-briefing sends the key on get_daily_stats, get_forfeiture_cases and post_slack_message', async () => {
    const { res, calls } = await runWithMocks(
        'daily-briefing',
        { get_daily_stats: { intakes: 0 }, get_forfeiture_cases: { cases: [] } },
        'TEST BRIEFING',
    );
    assert.equal(res.status, 200);
    assertAllKeyed(calls, ['get_daily_stats', 'get_forfeiture_cases', 'post_slack_message']);
});
