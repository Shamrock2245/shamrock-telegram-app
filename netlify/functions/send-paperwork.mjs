/**
 * send-paperwork.mjs — Netlify proxy for Shannon's mid-call SignNow tool
 * 
 * Architecture: ElevenLabs Agent Tool → this function → GAS → SignNow
 * 
 * This is a thin proxy — all SignNow logic lives in GAS.
 * Same pattern as elevenlabs-postcall.mjs.
 */

import { GAS_ENDPOINT } from './shared/ai-client.mjs';

// Shared secret — set SEND_PAPERWORK_SECRET in Netlify env vars.
// ElevenLabs tool must send: Authorization: Bearer <secret>
// If the env var is not set, the check is skipped (dev/test mode).
const SHARED_SECRET = process.env.SEND_PAPERWORK_SECRET || null;

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
        // --- Shared-secret guard ---
        // Set SEND_PAPERWORK_SECRET in Netlify env vars and configure the same
        // value as the Authorization header in the ElevenLabs tool definition.
        if (SHARED_SECRET) {
            const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
            const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
            if (provided !== SHARED_SECRET) {
                console.warn('[send-paperwork] Unauthorized request — bad or missing secret');
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

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
        const gasUrl = new URL(GAS_ENDPOINT);
        gasUrl.searchParams.set('source', 'send_paperwork');
        // encodeURIComponent ensures special chars in names/emails survive the URL round-trip
        gasUrl.searchParams.set('data', encodeURIComponent(JSON.stringify(data)));

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

        // --- Send signing link via SMS if available ---
        if (gasResult.success && gasResult.signing_link && data.caller_phone) {
            try {
                const smsResult = await sendTwilioSms(
                    data.caller_phone,
                    `Shamrock Bail Bonds — Your bail bond paperwork is ready to sign! Tap here to review and sign all documents: ${gasResult.signing_link}\n\nQuestions? Call (239) 332-2245`
                );
                if (smsResult.sent) {
                    console.log('[send-paperwork] SMS sent to', data.caller_phone);
                    gasResult.sms_sent = true;
                    // Update message for Shannon to read back
                    gasResult.message += ` I've also texted you a direct signing link at the number we have on file.`;
                } else {
                    console.warn('[send-paperwork] SMS failed:', smsResult.error);
                }
            } catch (smsErr) {
                console.warn('[send-paperwork] SMS error (non-fatal):', smsErr.message);
            }
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

/**
 * Send an SMS via Twilio REST API (no SDK needed).
 * Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 * @param {string} to - Recipient phone number
 * @param {string} body - Message body
 * @returns {{ sent: boolean, error?: string }}
 */
async function sendTwilioSms(to, body) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
        console.warn('[send-paperwork] Twilio env vars not set — skipping SMS');
        return { sent: false, error: 'Twilio not configured' };
    }

    // Clean the phone number — ensure E.164 format
    let cleanTo = to.replace(/\D/g, '');
    if (cleanTo.length === 10) cleanTo = '1' + cleanTo;
    if (!cleanTo.startsWith('+')) cleanTo = '+' + cleanTo;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.append('To', cleanTo);
    params.append('From', fromNumber);
    params.append('Body', body);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const result = await response.json();
        if (response.ok) {
            return { sent: true, sid: result.sid };
        } else {
            return { sent: false, error: result.message || `HTTP ${response.status}` };
        }
    } catch (err) {
        return { sent: false, error: err.message };
    }
}
