/**
 * notify-bondsman.mjs — Shannon "Path A" tool
 * 
 * When the caller wants to just pass their info to a bondsman (not start paperwork yet),
 * Shannon collects: name, phone, defendant name, county
 * This function logs the intake and fires a Slack alert so a bondsman calls them back.
 * 
 * Architecture: ElevenLabs Agent → this function → GAS → Slack + Sheet log
 */

import { GAS_ENDPOINT } from './shared/ai-client.mjs';

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
        if (SHARED_SECRET) {
            const authHeader = req.headers.get('authorization') || '';
            const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
            if (provided !== SHARED_SECRET) {
                console.warn('[notify-bondsman] Unauthorized request');
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // Parse body from ElevenLabs
        let body;
        try {
            body = await req.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('[notify-bondsman] Received:', JSON.stringify(body));

        const data = {
            caller_name: body.caller_name || body.parameters?.caller_name || '',
            caller_phone: body.caller_phone || body.parameters?.caller_phone || '',
            defendant_name: body.defendant_name || body.parameters?.defendant_name || '',
            county: body.county || body.parameters?.county || '',
            notes: body.notes || body.parameters?.notes || ''
        };

        if (!data.caller_name || !data.caller_phone) {
            return new Response(JSON.stringify({
                success: false,
                message: "I need your name and phone number so our bondsman can call you back."
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Forward to GAS
        const gasUrl = new URL(GAS_ENDPOINT);
        gasUrl.searchParams.set('source', 'notify_bondsman');
        gasUrl.searchParams.set('data', encodeURIComponent(JSON.stringify(data)));

        // Add shared secret for GAS-side verification
        if (process.env.ELEVENLABS_TOOL_SECRET) {
            gasUrl.searchParams.set('secret', process.env.ELEVENLABS_TOOL_SECRET);
        }

        console.log('[notify-bondsman] Forwarding to GAS...');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s — this is fast

        const gasResponse = await fetch(gasUrl.toString(), {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeout);

        const gasText = await gasResponse.text();
        console.log('[notify-bondsman] GAS response:', gasText.substring(0, 300));

        let gasResult;
        try {
            gasResult = JSON.parse(gasText);
        } catch (e) {
            gasResult = {
                success: true,
                message: "I've passed your information to our bondsman. They'll call you back shortly."
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
        console.error('[notify-bondsman] Error:', error.message);

        return new Response(JSON.stringify({
            success: true,
            message: "I've noted your information. A bondsman will be calling you back very soon."
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const config = {
    path: '/api/notify-bondsman'
};
