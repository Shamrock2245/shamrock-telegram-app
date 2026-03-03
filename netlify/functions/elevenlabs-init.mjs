/**
 * elevenlabs-init.mjs
 * Netlify Serverless Function — ElevenLabs Conversation Initiation Webhook
 *
 * Returns conversation_initiation_client_data with the caller's phone number
 * extracted from the Twilio call data that ElevenLabs forwards.
 *
 * URL: https://shamrock-telegram.netlify.app/api/elevenlabs-init
 */

export default async (request, context) => {
    // Always return JSON
    const headers = { 'Content-Type': 'application/json' };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    try {
        // Parse caller info from ElevenLabs POST body
        let callerPhone = '';
        let callSid = '';

        if (request.method === 'POST') {
            try {
                const body = await request.json();
                console.log('📞 ElevenLabs init body:', JSON.stringify(body));
                callerPhone = body.caller_id || body.from || '';
                callSid = body.call_sid || body.CallSid || '';
            } catch (e) {
                console.warn('Body parse failed:', e.message);
            }
        }

        // Also check query params as fallback
        if (!callerPhone || !callSid) {
            const url = new URL(request.url);
            if (!callerPhone) callerPhone = url.searchParams.get('caller_id') || url.searchParams.get('From') || '';
            if (!callSid) callSid = url.searchParams.get('call_sid') || url.searchParams.get('CallSid') || '';
        }

        // Clean phone to digits only
        const cleanPhone = callerPhone.replace(/\D/g, '');
        console.log(`📞 Caller: ${cleanPhone} | SID: ${callSid}`);

        // Return the exact format ElevenLabs expects
        return new Response(JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
                caller_phone: cleanPhone,
                call_sid: callSid
            },
            conversation_config_override: {
                agent: {
                    first_message: cleanPhone
                        ? `Thank you for calling Shamrock Bail Bonds. My name is Shannon. I can see you're calling from a number ending in ${cleanPhone.slice(-4)}. How can I help you today?`
                        : `Thank you for calling Shamrock Bail Bonds. My name is Shannon. How can I help you today?`
                }
            }
        }), { status: 200, headers });

    } catch (err) {
        console.error('ElevenLabs init error:', err);
        // NEVER crash — always return a valid response
        return new Response(JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: {},
            conversation_config_override: {
                agent: {
                    first_message: 'Thank you for calling Shamrock Bail Bonds. My name is Shannon. How can I help you today?'
                }
            }
        }), { status: 200, headers });
    }
};
