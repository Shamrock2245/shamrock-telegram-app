/**
 * elevenlabs-init.js — Edge Function (FAST — near-zero cold start)
 *
 * Fires at the start of every inbound Twilio call to the Shamrock
 * After-Hours agent. Returns caller ID and a personalized first message
 * so Shannon can greet callers by their phone number.
 *
 * Edge functions run on Deno at the CDN edge (<50ms startup)
 * vs serverless functions (3-8s cold start).
 *
 * URL: https://shamrock-telegram.netlify.app/api/elevenlabs-init
 */

export default async (request, context) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // CORS preflight — instant
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    try {
        // ── Parse caller info ──────────────────────────────
        let callerPhone = '';
        let callSid = '';

        if (request.method === 'POST') {
            try {
                const body = await request.json();
                console.log('📞 ElevenLabs init (edge):', JSON.stringify(body));
                callerPhone = body.caller_id || body.from || body.From || '';
                callSid = body.call_sid || body.CallSid || '';
            } catch (e) {
                console.warn('Body parse failed:', e.message);
            }
        }

        // Fallback: query params
        if (!callerPhone || !callSid) {
            const url = new URL(request.url);
            if (!callerPhone) callerPhone = url.searchParams.get('caller_id') || url.searchParams.get('From') || '';
            if (!callSid) callSid = url.searchParams.get('call_sid') || url.searchParams.get('CallSid') || '';
        }

        // Clean to digits, format for display
        const digits = callerPhone.replace(/\D/g, '');
        const last4 = digits.slice(-4);
        const displayPhone = digits.length === 10
            ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
            : digits.length === 11 && digits[0] === '1'
                ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
                : callerPhone;

        console.log(`📞 Caller: ${displayPhone} | SID: ${callSid}`);

        // ── Build personalized first message ─────────────
        const firstMessage = last4
            ? `Hi, this is Shannon with Shamrock Bail Bonds. I can see you're calling from the number ending in ${last4}. I'm here to help — can I get your name?`
            : `Hi, this is Shannon with Shamrock Bail Bonds. I'm available 24/7 to help you get your loved one home. Can I get your name to start?`;

        // ── Return immediately ───────────────────────────
        return new Response(JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
                caller_phone: displayPhone,
                caller_phone_raw: digits,
                call_sid: callSid
            },
            conversation_config_override: {
                agent: {
                    first_message: firstMessage
                }
            }
        }), { status: 200, headers });

    } catch (err) {
        console.error('ElevenLabs init error:', err);
        return new Response(JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: {},
            conversation_config_override: {
                agent: {
                    first_message: "Hi, this is Shannon with Shamrock Bail Bonds. I'm available 24/7 to help you get your loved one home. Can I get your name to start?"
                }
            }
        }), { status: 200, headers });
    }
};
