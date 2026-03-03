/**
 * elevenlabs-init.mjs
 * Netlify Serverless Function — ElevenLabs Conversation Initiation Webhook
 *
 * Handles the conversation_initiation_client_data webhook that fires
 * at the start of every inbound call to the Shamrock After-Hours agent.
 *
 * Why Netlify instead of GAS?
 * GAS responds with a 302 redirect on POST requests, which ElevenLabs
 * doesn't follow properly. Netlify returns a direct JSON response with
 * zero cold start.
 *
 * URL: https://shamrock-telegram.netlify.app/api/elevenlabs-init
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyCIDPzA_EA1B1SGsfhYiXRGKM8z61EgACZdDPILT_MjjXee0wSDEI0RRYthE0CvP-Z/exec';

// Default response — returned instantly if GAS is too slow or fails
const DEFAULT_RESPONSE = {
    type: 'conversation_initiation_client_data',
    dynamic_variables: {
        caller_name: '',
        caller_phone: '',
        has_existing_case: 'no',
        case_status: '',
        defendant_name: '',
        case_reference: '',
        last_contact: '',
        call_sid: ''
    },
    conversation_config_override: {
        agent: {
            first_message: 'Thank you for calling Shamrock Bail Bonds. My name is Shannon. How can I help you today?'
        }
    }
};

export default async (request, context) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    // ── Webhook Secret Auth (TEMPORARILY DISABLED FOR DEBUGGING) ──────
    // TODO: Re-enable after confirming calls work
    // const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
    // if (WEBHOOK_SECRET) {
    //     const url = new URL(request.url);
    //     const provided = request.headers.get('x-webhook-secret')
    //         || url.searchParams.get('webhook_secret');
    //     if (provided !== WEBHOOK_SECRET) {
    //         console.warn('⛔ ElevenLabs init — invalid or missing webhook secret');
    //         return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    //             status: 401, headers
    //         });
    //     }
    // }

    try {
        // Parse incoming data from ElevenLabs (POST body or query params)
        let callerId = '';
        let callSid = '';

        if (request.method === 'POST') {
            try {
                const body = await request.json();
                callerId = body.caller_id || '';
                callSid = body.call_sid || '';
            } catch (e) {
                // Body parse failed — not fatal
            }
        }

        // Also check query params
        const url = new URL(request.url);
        if (!callerId) callerId = url.searchParams.get('caller_id') || '';
        if (!callSid) callSid = url.searchParams.get('call_sid') || '';

        const cleanPhone = callerId.replace(/\D/g, '');

        console.log(`📞 ElevenLabs init | Caller: ${cleanPhone} | SID: ${callSid}`);

        // Build response with caller info as dynamic variables
        const response = {
            ...DEFAULT_RESPONSE,
            dynamic_variables: {
                ...DEFAULT_RESPONSE.dynamic_variables,
                caller_phone: cleanPhone,
                call_sid: callSid
            }
        };

        // Optional: Try to fetch personalized data from GAS (with tight timeout)
        // Disabled for now — GAS cold starts are too slow (4-7s)
        // Once we add CacheService or a warm-keep trigger, we can re-enable this:
        /*
        try {
            const gasResponse = await fetch(
                `${GAS_URL}?source=elevenlabs_init&caller_id=${encodeURIComponent(callerId)}&call_sid=${encodeURIComponent(callSid)}`,
                { signal: AbortSignal.timeout(3000) } // 3s max
            );
            if (gasResponse.ok) {
                const gasData = await gasResponse.json();
                return new Response(JSON.stringify(gasData), { status: 200, headers });
            }
        } catch (gasErr) {
            console.log('GAS lookup timed out, using default greeting');
        }
        */

        return new Response(JSON.stringify(response), { status: 200, headers });

    } catch (err) {
        console.error('ElevenLabs init error:', err);
        // ALWAYS return valid response — never crash the call
        return new Response(JSON.stringify(DEFAULT_RESPONSE), { status: 200, headers });
    }
};
