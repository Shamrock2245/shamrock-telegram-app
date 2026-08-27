/**
 * Twilio live-call redirect to the human office.
 *
 * ElevenLabs register-call cannot transfer (no Twilio credentials).
 * This updates the in-progress Programmable Voice call with Dial TwiML.
 *
 * Shannon "want a person" rings (239) 955-0301 first, then (239) 332-2245.
 * Never dial 727-295-2245.
 * URL: https://shamrock-telegram.netlify.app/api/twilio-transfer-office
 */

const TWILIO_NUMBER = '+17272952245';
const DESK_LINE = '+12399550301';
const NAP_LINE = '+12393322245';
const OFFICE_RING_SECONDS = 25;

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function toE164(value) {
    const d = digitsOnly(value);
    if (!d) return '';
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d.startsWith('1')) return '+' + d;
    if (String(value || '').startsWith('+') && d.length >= 10) return '+' + d;
    return '';
}

function isHumanDesk(value) {
    const d = digitsOnly(value);
    return (
        d === '12399550301' || d.endsWith('2399550301') ||
        d === '12393322245' || d.endsWith('2393322245')
    );
}

function isShannonLine(value) {
    const d = digitsOnly(value);
    return d === '17272952245' || d.endsWith('7272952245');
}

function isCallSid(value) {
    return /^CA[0-9a-f]{32}$/i.test(String(value || '').trim());
}

function officeDialTwiml() {
    return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response>' +
        '<Say>Please hold while I connect you to our office.</Say>' +
        `<Dial timeout="${OFFICE_RING_SECONDS}" callerId="${TWILIO_NUMBER}" answerOnBridge="true">` +
        `<Number>${DESK_LINE}</Number>` +
        '</Dial>' +
        `<Dial timeout="${OFFICE_RING_SECONDS}" callerId="${TWILIO_NUMBER}" answerOnBridge="true">` +
        `<Number>${NAP_LINE}</Number>` +
        '</Dial>' +
        '<Say>The office did not answer. Please call 239-955-0301, or 239-332-2245.</Say>' +
        '</Response>'
    );
}

function json(body, status) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Internal-Token',
        },
    });
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let out = 0;
    for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
}

function flattenBody(raw) {
    const nested = (raw && typeof raw === 'object' && raw.parameters) || {};
    return Object.assign({}, nested, raw || {});
}

function secretOk(request, body, url) {
    const expected = Deno.env.get('ELEVENLABS_TOOL_SECRET') || Deno.env.get('GAS_API_KEY') || '';
    if (!expected) return false;
    const auth = request.headers.get('authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const provided = [
        url.searchParams.get('secret'),
        request.headers.get('x-api-key'),
        request.headers.get('x-internal-token'),
        bearer,
        body.secret,
    ].filter(Boolean);
    return provided.some((value) => timingSafeEqual(String(value), expected));
}

function twilioAuthHeader() {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
    const token = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
    if (!sid || !token) return '';
    return 'Basic ' + btoa(sid + ':' + token);
}

async function twilioForm(path, method, params) {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
    const auth = twilioAuthHeader();
    if (!sid || !auth) throw new Error('twilio_env_missing');
    const url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + path;
    const body = params ? new URLSearchParams(params) : null;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: auth,
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
        signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_e) { data = { raw: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, data };
}

async function findInProgressSid(callerPhone) {
    const from = toE164(callerPhone);
    if (!from) return '';
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
    const q = '/Calls.json?Status=in-progress&From=' + encodeURIComponent(from) + '&PageSize=5';
    const res = await twilioForm(q, 'GET', null);
    const calls = (res.data && res.data.calls) || [];
    const match = calls.find((c) => isCallSid(c && c.sid) && !isShannonLine(c.to));
    return (match && match.sid) || ((calls[0] && calls[0].sid) || '');
}

async function redirectCall(callSid) {
    const twiml = officeDialTwiml();
    if (twiml.indexOf(DESK_LINE) === -1) throw new Error('twiml_missing_desk');
    if (twiml.indexOf(NAP_LINE) === -1) throw new Error('twiml_missing_nap');
    if (/<Number>\+17272952245<\/Number>/.test(twiml)) throw new Error('twiml_dials_shannon');
    return twilioForm('/Calls/' + callSid + '.json', 'POST', { Twiml: twiml });
}

export default async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Internal-Token',
            },
        });
    }
    if (request.method !== 'POST') {
        return json({ success: false, error: 'method_not_allowed' }, 405);
    }

    let raw = {};
    try {
        raw = await request.json() || {};
    } catch (_e) {
        raw = {};
    }
    const body = flattenBody(raw);
    const url = new URL(request.url);
    if (!secretOk(request, body, url)) {
        return json({ success: false, error: 'unauthorized' }, 401);
    }

    const callerPhone = toE164(body.caller_phone || body.caller_id || body.from || body.From || '');
    if (isHumanDesk(callerPhone)) {
        return json({
            success: false,
            error: 'loop_guard',
            result: 'Stay on this call. I cannot transfer the office line to itself. The desk is 239-955-0301.',
        });
    }

    let callSid = String(body.call_sid || body.CallSid || body.callSid || '').trim();
    if (!isCallSid(callSid) && callerPhone) {
        try {
            callSid = await findInProgressSid(callerPhone);
        } catch (err) {
            console.error('Twilio lookup failed:', err.message);
        }
    }
    if (!isCallSid(callSid)) {
        return json({
            success: false,
            error: 'missing_call_sid',
            result: 'I cannot connect this live call automatically. Please call the office at 239-955-0301.',
        });
    }

    try {
        const redirected = await redirectCall(callSid);
        if (!redirected.ok) {
            console.error('Twilio redirect failed', redirected.status);
            return json({
                success: false,
                error: 'twilio_redirect_failed',
                result: 'I could not connect the live call. Please call the office at 239-955-0301.',
            });
        }
        return json({
            success: true,
            status: 'connecting',
            office: '239-955-0301',
            backup: '239-332-2245',
            result: 'Connecting you to the office at 239-955-0301 now. Please stay on the line.',
        });
    } catch (err) {
        console.error('Transfer error:', err.message);
        return json({
            success: false,
            error: 'transfer_error',
            result: 'I could not connect the live call. Please call the office at 239-955-0301.',
        });
    }
};
