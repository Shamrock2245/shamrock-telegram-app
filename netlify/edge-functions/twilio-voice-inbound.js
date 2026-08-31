/**
 * twilio-voice-inbound.js — Smart Call Router (Edge Function)
 *
 *   • (727) 295-2245 — Shannon when SHANNON_LIVE=true
 *   • Human office / jail whitelist — ring 239-332-2245 and 239-955-0301 together
 *   • Shannon "want a person" live transfer is twilio-transfer-office.js
 *   • SHANNON_LIVE=false → 727 rings both office lines; Shannon if nobody answers
 *
 * Never dial 727-295-2245 from this webhook (that is Shannon's own number).
 * 239-332-2245 must not call-forward back to 727.
 *
 * URL: https://shamrock-telegram.netlify.app/api/twilio-voice
 */

const EXACT_WHITELIST = new Set([
    '12394771500',
    '12394771700',
    '12393368019',
    '12393373135',
    '12393396443',
    '12393547068',
    '19416212140',
    '19415319469',
    '19412100540',
    '18667329098',
    '18776504249',
    '18004838314',
    '18008446591',
    '18885068407',
]);

const PREFIX_WHITELIST = [
    '1239477',
];

const TWILIO_NUMBER = '+17272952245';
const LANDLINE = '+12393322245';
const DESK_CELL = '+12399550301';
const OFFICE_RING_SECONDS = 25;

const XML_HEADERS = {
    'Content-Type': 'application/xml',
    'Cache-Control': 'no-cache',
};

const CANONICAL_VOICE_URL = 'https://shamrock-telegram.netlify.app/api/twilio-voice';

const OPENING_TAILS = [
    'How can I help today?',
    'How can I help you today?',
    'What can I do for you?',
    'How can I help?',
    "I'm here, how can I help?",
    'What can I help you with?',
];

function shannonOpening() {
    const tail = OPENING_TAILS[Math.floor(Math.random() * OPENING_TAILS.length)];
    return 'Shamrock Bail Bonds! This is Shannon. ' + tail;
}

function isWhitelisted(digits) {
    if (EXACT_WHITELIST.has(digits)) return true;
    for (const prefix of PREFIX_WHITELIST) {
        if (digits.startsWith(prefix)) return true;
    }
    return false;
}

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function isOfficeLine(digits) {
    const d = digitsOnly(digits);
    return (
        d === '12393322245' || d.endsWith('2393322245') ||
        d === '12399550301' || d.endsWith('2399550301')
    );
}

function dialCallerId(_callerDigits) {
    // Twilio only accepts a Twilio number or verified caller ID on Dial.
    return TWILIO_NUMBER;
}

function buildDialTwiML(callerDigits) {
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
    if (!isOfficeLine(callerDigits)) {
        twiml += `<Dial timeout="${OFFICE_RING_SECONDS}" callerId="${dialCallerId(callerDigits)}" answerOnBridge="true">`;
        twiml += `<Number>${LANDLINE}</Number>`;
        twiml += `<Number>${DESK_CELL}</Number>`;
        twiml += '</Dial>';
    }
    twiml += '<Say>Please hold while we connect you to our answering service.</Say>';
    twiml += '<Pause length="1"/>';
    twiml += '<Redirect method="POST">/api/twilio-voice?force_ai=true</Redirect>';
    twiml += '</Response>';
    return twiml;
}

function rejectTwiML() {
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
}

async function lookupMem0Context(fromNumber) {
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

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let out = 0;
    for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
}

async function hmacSha1Base64(secret, message) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const bytes = new Uint8Array(sig);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function webhookUrlsToCheck(request) {
    const incoming = new URL(request.url);
    const search = incoming.search || '';
    const configured = (Deno.env.get('TWILIO_VOICE_WEBHOOK_URL') || CANONICAL_VOICE_URL).replace(/\/$/, '');
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || incoming.host;
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    return [
        configured + search,
        `${proto}://${host}${incoming.pathname}${search}`,
        CANONICAL_VOICE_URL + search,
    ].filter((url, idx, arr) => arr.indexOf(url) === idx);
}

async function twilioSignatureValid(request, params) {
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
    const signature = request.headers.get('X-Twilio-Signature') || '';
    if (!authToken || !signature) return false;
    const sorted = Object.keys(params).sort().map((key) => key + params[key]).join('');
    for (const url of webhookUrlsToCheck(request)) {
        const expected = await hmacSha1Base64(authToken, url + sorted);
        if (timingSafeEqual(expected, signature)) return true;
    }
    return false;
}

export default async (request, context) => {
    let from = '';
    let to = '';
    let callSid = '';
    let forceAI = false;
    const params = {};

    try {
        const url = new URL(request.url);
        forceAI = url.searchParams.get('force_ai') === 'true';

        if (request.method === 'POST') {
            const body = await request.text();
            const form = new URLSearchParams(body);
            for (const [key, value] of form.entries()) params[key] = value;
            from = form.get('From') || form.get('Caller') || '';
            to = form.get('To') || form.get('Called') || '';
            callSid = form.get('CallSid') || '';
        }

        if (!from) from = new URL(request.url).searchParams.get('From') || '';
        if (!to) to = new URL(request.url).searchParams.get('To') || '';
        if (!callSid) callSid = new URL(request.url).searchParams.get('CallSid') || '';
    } catch (e) {
        console.error('Parse error:', e.message);
    }

    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
    if (authToken) {
        const ok = await twilioSignatureValid(request, params);
        if (!ok) {
            console.error('❌ Invalid or missing X-Twilio-Signature');
            return new Response(rejectTwiML(), { status: 403, headers: XML_HEADERS });
        }
    } else {
        console.error('❌ TWILIO_AUTH_TOKEN missing — rejecting voice webhook');
        return new Response(rejectTwiML(), { status: 403, headers: XML_HEADERS });
    }

    const digits = digitsOnly(from);
    console.log(`📞 Voice inbound | From: ${from} | To: ${to} | SID: ${callSid} | ForceAI: ${forceAI}`);

    const shannonFront = (Deno.env.get('SHANNON_LIVE') || 'true').toLowerCase() !== 'false';

    if (!forceAI && isWhitelisted(digits)) {
        console.log(`✅ WHITELISTED — routing to ${LANDLINE} and ${DESK_CELL}`);
        return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
    }

    if (!forceAI && !shannonFront) {
        console.log(`☎️ FORWARD — ${TWILIO_NUMBER} → ${LANDLINE} + ${DESK_CELL}`);
        return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
    }

    console.log('🤖 AI ROUTE — Shannon paperwork assistant');

    try {
        const mem0 = await lookupMem0Context(from);
        const shannonId = Deno.env.get('ELEVENLABS_AGENT_ID') || 'agent_2001kjth4na5ftqvdf1pp3gfb1cb';
        const ericId = Deno.env.get('ELEVENLABS_AGENT_ID_2') || 'agent_5601kjwvbc4pf92snj0yr44fbpvd';
        const rotateEric = (Deno.env.get('SHANNON_ROTATE_ERIC') || 'false').toLowerCase() === 'true';
        const agentId = rotateEric
            ? [shannonId, ericId][Math.floor(Math.random() * 2)]
            : shannonId;
        const apiKey = Deno.env.get('ELEVENLABS_API_KEY');

        console.log(`🎙️ Selected agent: ${agentId === ericId ? 'Eric' : 'Shannon'}`);

        if (!apiKey) {
            console.error('❌ ELEVENLABS_API_KEY not set!');
            return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
        }

        const registerRes = await fetch(
            'https://api.elevenlabs.io/v1/convai/twilio/register-call',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': apiKey,
                },
                body: JSON.stringify({
                    agent_id: agentId,
                    from_number: from,
                    to_number: to || '+17272952245',
                    direction: 'inbound',
                    conversation_initiation_client_data: {
                        dynamic_variables: {
                            caller_phone: from,
                            caller_id: from,
                            call_sid: callSid,
                            returning_client: mem0.returning_client || 'no',
                            known_defendant: mem0.known_defendant || '',
                            prior_notes: mem0.prior_notes || '',
                            is_jail_call: (digits.startsWith('1239477') || isWhitelisted(digits)) ? 'yes' : 'no',
                            jail_facility: digits.startsWith('1239477') ? 'Lee County Jail (Press 0 to talk to inmate)' : '',
                        },
                        conversation_config_override: {
                            agent: { first_message: shannonOpening() },
                        },
                        source_info: { source: 'twilio' },
                    },
                }),
                signal: AbortSignal.timeout(12000),
            }
        );

        if (!registerRes.ok) {
            const errText = await registerRes.text();
            console.error(`❌ ElevenLabs Register Call failed: ${registerRes.status} — ${errText}`);
            return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
        }

        const twiml = await registerRes.text();
        if (!twiml || twiml.indexOf('<Response') === -1) {
            console.error('❌ ElevenLabs returned non-TwiML payload');
            return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
        }
        console.log(`✅ ElevenLabs TwiML received (${twiml.length} chars)`);
        return new Response(twiml, { status: 200, headers: XML_HEADERS });
    } catch (err) {
        console.error(`❌ ElevenLabs error: ${err.message}`);
        return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
    }
};
