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
import { buildCrmIntakeBody, submitCrmIntake } from './shared/crm-intake.mjs';

const SHARED_SECRET = process.env.SEND_PAPERWORK_SECRET || null;

function looksLikeCallSid(ref) {
    const value = String(ref || '').trim();
    return /^(CA|SM|MM|NO|PN)[0-9a-f]{32}$/i.test(value) || /^(conv_|tlcal_)/i.test(value);
}

function notifyCaseReference(body, data) {
    const params = (body && body.parameters) || {};
    const given = String(
        (body && (body.case_reference || body.packet_id))
        || params.case_reference
        || params.packet_id
        || ''
    ).trim();
    if (given && !looksLikeCallSid(given)) return given;
    const phone = String((data && data.caller_phone) || '').replace(/\D/g, '').slice(-10);
    const defName = String((data && data.defendant_name) || '').trim().toUpperCase().replace(/\s+/g, '-').slice(0, 24);
    return 'SH-' + (phone || 'UNK') + '-' + (defName || Date.now().toString(36).toUpperCase());
}

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

        console.log('[notify-bondsman] Received notification request.');

        const params = body.parameters || {};
        const data = {
            caller_name: body.caller_name || params.caller_name || '',
            caller_phone: body.caller_phone || params.caller_phone || '',
            defendant_name: body.defendant_name || params.defendant_name || '',
            county: body.county || params.county || '',
            notes: body.notes || params.notes || '',
            preferred_time: body.preferred_time || params.preferred_time || 'ASAP',
        };
        data.case_reference = notifyCaseReference(body, data);

        if (!data.caller_name || !data.caller_phone) {
            return new Response(JSON.stringify({
                success: false,
                message: "I need your name and phone number so our bondsman can call you back."
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const crmBody = buildCrmIntakeBody('shannon_voice', { said: data, intakeId: data.case_reference });
        const crm = await submitCrmIntake(crmBody);
        if (!crm.ok) {
            console.error('[notify-bondsman] CRM intake failed; still forwarding the callback to GAS error=' + crm.error);
        }

        // GAS always runs the callback scheduler and the staff-desk text.
        // A CRM success only skips the Slack post on that side.
        const gasUrl = new URL(GAS_ENDPOINT);
        gasUrl.searchParams.set('source', 'notify_bondsman');
        gasUrl.searchParams.set('data', encodeURIComponent(JSON.stringify(data)));

        // Add shared secret for GAS-side verification
        if (process.env.ELEVENLABS_TOOL_SECRET) {
            gasUrl.searchParams.set('secret', process.env.ELEVENLABS_TOOL_SECRET);
        }

        console.log('[notify-bondsman] Forwarding to GAS...');

        const controller = new AbortController();
        // CRM submit is capped at 4s. Keep this well under the 10s function limit.
        const timeout = setTimeout(() => controller.abort(), 5000);

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

        if (crm.ok) {
            return new Response(JSON.stringify({
                success: true,
                via: 'crm',
                intake_id: crm.intake_id || data.case_reference,
                case_reference: data.case_reference,
                message: "I've passed your information to our bondsman. They'll call you back shortly."
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
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
