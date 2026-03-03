/**
 * elevenlabs-postcall.mjs
 * Netlify Serverless Function — Post-Call Webhook Proxy
 *
 * Receives post-call data from ElevenLabs (transcript, analysis, metadata)
 * and forwards it to GAS for processing. This avoids the GAS 302 redirect
 * issue on POST requests.
 *
 * GAS handles: transcript archival, Slack alerts, SMS confirmations,
 * IntakeQueue writes, and Google Drive storage.
 *
 * URL: https://shamrock-telegram.netlify.app/api/elevenlabs-postcall
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyCIDPzA_EA1B1SGsfhYiXRGKM8z61EgACZdDPILT_MjjXee0wSDEI0RRYthE0CvP-Z/exec';

export default async (request, context) => {
    const headers = { 'Content-Type': 'application/json' };

    // CORS preflight
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
        // ── Parse the post-call payload from ElevenLabs ──────────────
        let payload = {};

        if (request.method === 'POST') {
            try {
                payload = await request.json();
            } catch (e) {
                console.error('❌ Post-call body parse failed:', e.message);
                return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                    status: 400, headers
                });
            }
        }

        const callId = payload.call_id || 'unknown';
        const eventType = payload.type || 'unknown';
        const messageCount = payload.transcription ? payload.transcription.length : 0;

        console.log(`🎙️ Post-call webhook | Type: ${eventType} | Call: ${callId} | Messages: ${messageCount}`);

        // ── Forward to GAS via GET (avoids 302 redirect on POST) ─────
        // Encode the full payload as a URL parameter
        const encodedPayload = encodeURIComponent(JSON.stringify(payload));
        const gasUrl = `${GAS_URL}?source=elevenlabs_webhook&postcall_data=${encodedPayload}`;

        // Fire-and-forget to GAS (don't block the response)
        // Use a 15-second timeout since GAS can be slow
        const gasPromise = fetch(gasUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(15000)
        }).then(res => {
            console.log(`✅ GAS forwarded | Status: ${res.status}`);
        }).catch(err => {
            console.error(`⚠️ GAS forward failed (non-fatal): ${err.message}`);
        });

        // Wait briefly for GAS but don't hold up the response too long
        // ElevenLabs doesn't need a fast response for post-call
        await Promise.race([
            gasPromise,
            new Promise(resolve => setTimeout(resolve, 10000)) // 10s max wait
        ]);

        // ── Return success to ElevenLabs ─────────────────────────────
        return new Response(JSON.stringify({
            status: 'received',
            call_id: callId,
            forwarded_to: 'gas'
        }), { status: 200, headers });

    } catch (err) {
        console.error('Post-call webhook error:', err);
        return new Response(JSON.stringify({
            status: 'error',
            message: err.message
        }), { status: 500, headers });
    }
};
