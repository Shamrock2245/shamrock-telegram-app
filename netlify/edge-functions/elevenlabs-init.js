/**
 * elevenlabs-init.js — conversation start for Shannon.
 *
 * One memory path: Super CRM /api/agent-brain/memory/lookup (same as
 * twilio-voice-inbound.js). Do not call Mem0 or GAS here.
 * Greeting is always the short listen-first line.
 *
 * URL: https://shamrock-telegram.netlify.app/api/elevenlabs-init
 */

const ANON_IDS = new Set(['', 'anonymous', 'unknown', 'restricted', 'unavailable']);

function extractCallerPhone(body, url) {
    const nested = (body && body.dynamic_variables) || {};
    const candidates = [
        body && body.caller_id,
        body && body.from_number,
        body && body.from,
        body && body.From,
        body && body.caller_phone,
        nested.caller_id,
        nested.from_number,
        nested.caller_phone,
        url.searchParams.get('caller_id'),
        url.searchParams.get('from_number'),
        url.searchParams.get('From'),
        url.searchParams.get('from'),
    ];
    for (const raw of candidates) {
        const value = String(raw || '').trim();
        if (!value || ANON_IDS.has(value.toLowerCase())) continue;
        if (value.replace(/\D/g, '').length < 7) continue;
        return value;
    }
    return '';
}

const OPENING_TAILS = [
    'How can I help today?',
    'What can I do for you?',
    'How can I help?',
    'What do you need?',
];

function shannonOpening() {
    const tail = OPENING_TAILS[Math.floor(Math.random() * OPENING_TAILS.length)];
    return 'Shamrock Bail Bonds! This is Shannon. ' + tail;
}

function openingOverride() {
    return { agent: { first_message: shannonOpening() } };
}

function emptyInitPayload() {
    return {
        type: 'conversation_initiation_client_data',
        conversation_config_override: openingOverride(),
    };
}

async function lookupCrmMemory(fromNumber) {
    const key = Deno.env.get('GAS_API_KEY') || Deno.env.get('LEADS_INTERNAL_TOKEN') || '';
    if (!key || !fromNumber) return {};
    const base = (Deno.env.get('SHANNON_LEADS_URL') || 'https://leads.shamrockbailbonds.biz').replace(/\/$/, '');
    try {
        const res = await fetch(`${base}/api/agent-brain/memory/lookup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': key,
                'X-Internal-Token': key,
            },
            body: JSON.stringify({
                phone: fromNumber,
                query: 'prior bail bond conversation defendant county paperwork',
            }),
            signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return {};
        const body = await res.json();
        return {
            returning_client: body.returning_client || 'no',
            known_defendant: body.known_defendant || '',
            prior_notes: body.prior_notes || '',
        };
    } catch (_err) {
        return {};
    }
}

export default async (request) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    let body = {};
    let callSid = '';
    try {
        if (request.method === 'POST') {
            body = await request.json() || {};
            callSid = body.call_sid || body.CallSid || '';
        }
    } catch (_e) {
        body = {};
    }
    const url = new URL(request.url);
    const callerPhone = extractCallerPhone(body, url);
    if (!callSid) callSid = url.searchParams.get('call_sid') || url.searchParams.get('CallSid') || '';

    // No caller ID: do not inject returning_client:no (that can wipe Mem0 context).
    if (!callerPhone) {
        return new Response(JSON.stringify(emptyInitPayload()), { status: 200, headers });
    }

    const mem = await lookupCrmMemory(callerPhone);
    const payload = {
        type: 'conversation_initiation_client_data',
        dynamic_variables: {
            caller_phone: callerPhone,
            caller_id: callerPhone,
            call_sid: callSid,
            returning_client: mem.returning_client || 'no',
            known_defendant: mem.known_defendant || '',
            prior_notes: mem.prior_notes || '',
        },
        conversation_config_override: openingOverride(),
    };
    return new Response(JSON.stringify(payload), { status: 200, headers });
};
