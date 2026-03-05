/**
 * twilio-voice-inbound.js — Smart Call Router (Edge Function)
 *
 * Incoming Twilio voice calls are routed by caller ID:
 *   • Whitelisted numbers (jails, sheriff) → ring office phones
 *   • Everyone else → ElevenLabs AI agent (Shannon)
 *
 * Edge function = near-zero cold start. Critical for voice.
 *
 * URL: https://shamrock-telegram.netlify.app/api/twilio-voice
 */

// ═══════════════════════════════════════════════════════════════
// WHITELIST — Edit this section to add/remove numbers
// ═══════════════════════════════════════════════════════════════

/**
 * Exact phone numbers that ring through to office.
 * Format: E.164 without the '+' (e.g., '12394771500')
 */
const EXACT_WHITELIST = new Set([
    // Lee County Jail / Sheriff
    '12394771500',   // Main jail line
    '12394771700',   // Sheriff admin
    // Known direct lines
    '12393368019',   // Known jail-related
    // Jail collect call numbers (GTL / facility-specific)
    '12393373135',   // Jail collect
    '12393396443',   // Jail collect
    '12393547068',   // Jail collect
    '19416212140',   // Jail collect (Charlotte County area)
    '19415319469',   // Jail collect (Sarasota/Charlotte area)
    '19412100540',   // Jail collect (Sarasota/Charlotte area)
    // GTL / ConnectNetwork / ViaPath (Lee County inmate call provider)
    '18667329098',   // GTL customer service
    '18776504249',   // GTL billing
    '18004838314',   // GTL AdvancePay
    // Securus Technologies
    '18008446591',   // Securus customer service
    // ICSolutions
    '18885068407',   // ICSolutions customer service
]);

/**
 * Prefix patterns — any number starting with these digits matches.
 * Format: digits after country code '1' (e.g., '239477' matches all 239-477-****)
 */
const PREFIX_WHITELIST = [
    '1239477',       // All Lee County Sheriff's Office numbers (239-477-****)
];

// ═══════════════════════════════════════════════════════════════
// OFFICE ROUTING — Sequential ring
// ═══════════════════════════════════════════════════════════════

const OFFICE_PHONES = [
    { number: '+12399550178', timeout: 20 },  // Primary office
    { number: '+12399550301', timeout: 25 },  // Spanish / fallback
];

const SPANISH_DIRECT = '+12399550301';

// ═══════════════════════════════════════════════════════════════

/**
 * Check if a phone number (digits only) matches the whitelist.
 */
function isWhitelisted(digits) {
    if (EXACT_WHITELIST.has(digits)) return true;
    for (const prefix of PREFIX_WHITELIST) {
        if (digits.startsWith(prefix)) return true;
    }
    return false;
}

/**
 * Build TwiML to ring office phones sequentially.
 */
function buildDialTwiML(callerDigits) {
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

    for (const phone of OFFICE_PHONES) {
        twiml += `<Dial timeout="${phone.timeout}" callerId="+${callerDigits}">`;
        twiml += `<Number>${phone.number}</Number>`;
        twiml += '</Dial>';
    }

    // If nobody picks up, send to Shannon as fallback
    twiml += '<Say voice="alice">Please hold while we connect you to our answering service.</Say>';
    twiml += '<Pause length="1"/>';
    // Redirect to self with a flag to force AI routing
    twiml += '<Redirect method="POST">/api/twilio-voice?force_ai=true</Redirect>';
    twiml += '</Response>';

    return twiml;
}

export default async (request, context) => {
    const XML_HEADERS = {
        'Content-Type': 'application/xml',
        'Cache-Control': 'no-cache',
    };

    // ── Parse Twilio form-encoded POST ──────────────────────
    let from = '';
    let callSid = '';
    let forceAI = false;

    try {
        const url = new URL(request.url);
        forceAI = url.searchParams.get('force_ai') === 'true';

        if (request.method === 'POST') {
            const body = await request.text();
            const params = new URLSearchParams(body);
            from = params.get('From') || params.get('Caller') || '';
            callSid = params.get('CallSid') || '';
        }

        // Fallback to query params
        if (!from) from = new URL(request.url).searchParams.get('From') || '';
        if (!callSid) callSid = new URL(request.url).searchParams.get('CallSid') || '';
    } catch (e) {
        console.error('Parse error:', e.message);
    }

    // Clean to digits only
    const digits = from.replace(/\D/g, '');

    console.log(`📞 Voice inbound | From: ${from} | Digits: ${digits} | SID: ${callSid} | ForceAI: ${forceAI}`);

    // ── Route Decision ──────────────────────────────────────

    if (!forceAI && isWhitelisted(digits)) {
        // ✅ JAIL/SHERIFF — Ring office phones
        console.log(`✅ WHITELISTED — routing to office phones`);
        const twiml = buildDialTwiML(digits);
        return new Response(twiml, { status: 200, headers: XML_HEADERS });
    }

    // ❌ NOT WHITELISTED (or fallback) — Route to ElevenLabs AI
    console.log(`🤖 AI ROUTE — selecting agent (Shannon or Eric)...`);

    try {
        // ── Route to ElevenLabs AI ──────────────────────────────────────
        // Randomly rotate between Shannon (female) and Eric (male) on each call.
        // Both agents have the same role — callers get variety.
        const AGENT_IDS = [
            Deno.env.get('ELEVENLABS_AGENT_ID') || 'agent_2001kjth4na5ftqvdf1pp3gfb1cb',  // Shannon
            Deno.env.get('ELEVENLABS_AGENT_ID_2') || 'agent_5601kjwvbc4pf92snj0yr44fbpvd', // Eric
        ];
        const agentId = AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)];
        const apiKey = Deno.env.get('ELEVENLABS_API_KEY');

        console.log(`🎙️ Selected agent: ${agentId === AGENT_IDS[0] ? 'Shannon' : 'Eric'}`);

        if (!apiKey) {
            console.error('❌ ELEVENLABS_API_KEY not set!');
            // Fallback: ring office if API key missing
            return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
        }

        // Call ElevenLabs Register Call API
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
                    to_number: '+17272952245',
                }),
                signal: AbortSignal.timeout(5000),  // 5s max — caller is waiting
            }
        );

        if (!registerRes.ok) {
            const errText = await registerRes.text();
            console.error(`❌ ElevenLabs Register Call failed: ${registerRes.status} — ${errText}`);
            // Fallback: ring office
            return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
        }

        // ElevenLabs returns TwiML directly
        const twiml = await registerRes.text();
        console.log(`✅ ElevenLabs TwiML received (${twiml.length} chars)`);
        return new Response(twiml, { status: 200, headers: XML_HEADERS });

    } catch (err) {
        console.error(`❌ ElevenLabs error: ${err.message}`);
        // Ultimate fallback: ring office — never drop a call
        return new Response(buildDialTwiML(digits), { status: 200, headers: XML_HEADERS });
    }
};
