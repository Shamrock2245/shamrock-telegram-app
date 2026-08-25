/**
 * twilio-voice-inbound.js — Smart Call Router (Edge Function)
 *
 * Incoming Twilio voice calls are routed by caller ID + Shannon switch:
 *   • Whitelisted numbers (jails, sheriff) → ring office phones
 *   • SHANNON_LIVE=true (default) → Shannon paperwork assistant
 *   • SHANNON_LIVE=false → ring office phones (Shannon only if nobody answers)
 *
 * Production notes (ElevenLabs register-call + Twilio 2026 docs):
 *   • Pass Twilio From/To, direction=inbound, and caller_phone dynamic vars
 *   • Agent audio must be μ-law 8000 Hz
 *   • Live SIP transfer is not available on register-call; Shannon texts via BlueBubbles
 *   • Validate X-Twilio-Signature before returning TwiML
 *
 * Brendan flips SHANNON_LIVE in Netlify env. No code change required.
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

const OFFICE_PHONES = [
    { number: '+12399550178', timeout: 20 },
    { number: '+12399550301', timeout: 25 },
];

const XML_HEADERS = {
    'Content-Type': 'application/xml',
    'Cache-Control': 'no-cache',
};

const CANONICAL_VOICE_URL = 'https://shamrock-telegram.netlify.app/api/twilio-voice';

function isWhitelisted(digits) {
    if (EXACT_WHITELIST.has(digits)) return true;
    for (const prefix of PREFIX_WHITELIST) {
        if (digits.startsWith(prefix)) return true;
    }
    return false;
}

function buildDialTwiML(callerDigits) {
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
    for (const phone of OFFICE_PHONES) {
        twiml += `<Dial timeout="${phone.timeout}" callerId="+${callerDigits}">`;
        twiml += `<Number>${phone.number}</Number>`;
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

    const digits = from.replace(/\D/g, '');
    console.log(`📞 Voice inbound | From: ${from} | To: ${to} | SID: ${callSid} | ForceAI: ${forceAI}`);

    if (!forceAI && isWhitelisted(digits)) {
        console.log('✅ WHITELISTED — routing to office phones');
        return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
    }

    const shannonLive = (Deno.env.get('SHANNON_LIVE') || 'true').toLowerCase() !== 'false';
    if (!forceAI && !shannonLive) {
        console.log('🔌 SHANNON_LIVE=false — routing public caller to office phones');
        return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
    }

    console.log('🤖 AI ROUTE — Shannon paperwork assistant');

    try {
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
