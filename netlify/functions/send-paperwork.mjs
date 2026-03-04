/**
 * send-paperwork.mjs — Netlify proxy for Shannon's mid-call SignNow tool
 * 
 * Architecture: ElevenLabs Agent Tool → this function → GAS → SignNow
 * 
 * This is a thin proxy — all SignNow logic lives in GAS.
 * Same pattern as elevenlabs-postcall.mjs.
 */

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || 'https://script.google.com/macros/s/AKfycbzm5zmGVcRm_SNRddBF55_5mxMpmIW2ENmHnxkNJNvbC53IwDqoYhBdTVYQ6FE9Zewk/exec';

export default async (req, context) => {
    // CORS
    if (req.method === 'OPTIONS') {
        return new Response('', {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Parse the incoming request from ElevenLabs
        let body;
        try {
            body = await req.json();
        } catch (e) {
            console.error('[send-paperwork] Failed to parse body:', e.message);
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('[send-paperwork] Received from ElevenLabs:', JSON.stringify(body));

        // Extract fields — ElevenLabs may nest them in different places
        const data = {
            caller_name: body.caller_name || body.parameters?.caller_name || '',
            caller_email: body.caller_email || body.parameters?.caller_email || '',
            caller_phone: body.caller_phone || body.parameters?.caller_phone || '',
            defendant_name: body.defendant_name || body.parameters?.defendant_name || '',
            county: body.county || body.parameters?.county || ''
        };

        console.log('[send-paperwork] Extracted data:', JSON.stringify(data));

        if (!data.caller_name || !data.caller_email || !data.defendant_name) {
            return new Response(JSON.stringify({
                success: false,
                message: "I need the caller's full name, email address, and defendant's name to send paperwork."
            }), {
                status: 200, // 200 so ElevenLabs can read the error message
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Forward to GAS
        const gasUrl = new URL(GAS_WEB_APP_URL);
        gasUrl.searchParams.set('source', 'send_paperwork');
        gasUrl.searchParams.set('data', JSON.stringify(data));

        console.log('[send-paperwork] Forwarding to GAS...');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

        const gasResponse = await fetch(gasUrl.toString(), {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeout);

        // GAS returns 302 redirect to the actual response — follow it
        const gasText = await gasResponse.text();
        console.log('[send-paperwork] GAS response:', gasText.substring(0, 500));

        let gasResult;
        try {
            gasResult = JSON.parse(gasText);
        } catch (e) {
            // GAS might return HTML if there's a redirect issue
            gasResult = {
                success: true,
                message: "The paperwork is being prepared and will be sent to your email shortly."
            };
        }

        return new Response(JSON.stringify(gasResult), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        console.error('[send-paperwork] Error:', error.message);

        // If timeout, still return a friendly message
        if (error.name === 'AbortError') {
            return new Response(JSON.stringify({
                success: true,
                message: "The paperwork is being prepared and will be sent to your email shortly. " +
                    "It may take a minute or two to arrive."
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: false,
            message: "I'm having trouble sending the paperwork right now. " +
                "Our team will follow up with you to get everything sent."
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const config = {
    path: '/api/send-paperwork'
};
