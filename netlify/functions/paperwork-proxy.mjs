/**
 * Paperwork proxy — Telegram / Wix popup → Super CRM PIN portal.
 *
 * Does not create packets. Staff still must validate Match → BondCase →
 * surety → POA before a DocuSeal signing link exists.
 *
 * POST /api/paperwork
 *   JSON:  { action, ... }
 *   Form:  action=id-ocr + session_token + file
 */
import { CORS_HEADERS, handleOptions, errorResponse, jsonResponse } from './shared/ai-client.mjs';

const CRM_BASE = (process.env.LEADS_API_URL || process.env.CRM_API_URL || 'https://leads.shamrockbailbonds.biz').replace(/\/$/, '');

const ACTIONS = {
    'send-pin': { path: '/api/portal/send-pin', method: 'POST' },
    'verify-pin': { path: '/api/portal/verify-pin', method: 'POST' },
    session: { path: '/api/portal/session', method: 'POST' },
    'id-ocr': { path: '/api/portal/id-ocr', method: 'POST' },
    selfie: { path: '/api/portal/selfie', method: 'POST' },
    fields: { path: '/api/portal/remaining-fields', method: 'POST' },
};

function redact(value) {
    if (!value || typeof value !== 'object') return value;
    const copy = { ...value };
    for (const key of ['phone', 'email', 'session_token', 'token', 'pin', 'indemnitor_ssn', 'indemnitor_dl']) {
        if (copy[key]) copy[key] = '[redacted]';
    }
    if (copy.fields && typeof copy.fields === 'object') {
        copy.fields = { keys: Object.keys(copy.fields), count: Object.keys(copy.fields).length };
    }
    return copy;
}

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST' && req.method !== 'GET') {
        return errorResponse('Method not allowed', 405);
    }

    try {
        const contentType = req.headers.get('content-type') || '';
        let action = '';
        let payload = {};
        let outboundBody;
        let outboundHeaders = { Accept: 'application/json' };

        if (req.method === 'GET') {
            const url = new URL(req.url);
            action = url.searchParams.get('action') || 'session';
            payload = {
                session_token: url.searchParams.get('token') || url.searchParams.get('session_token') || '',
            };
        } else if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            action = String(form.get('action') || 'id-ocr');
            outboundBody = form;
        } else {
            try {
                payload = await req.json();
            } catch {
                payload = {};
            }
            action = payload.action || '';
        }

        const route = ACTIONS[action];
        if (!route) {
            return errorResponse('Unknown paperwork action', 400);
        }

        const target = new URL(CRM_BASE + route.path);
        if (action === 'session' && payload.session_token) {
            target.searchParams.set('token', payload.session_token);
        }

        if (!outboundBody) {
            outboundHeaders['Content-Type'] = 'application/json';
            outboundBody = JSON.stringify(payload);
        }

        console.log('[paperwork-proxy]', action, JSON.stringify(redact(payload)));

        const crmRes = await fetch(target.toString(), {
            method: route.method,
            headers: outboundHeaders,
            body: route.method === 'GET' ? undefined : outboundBody,
        });

        const text = await crmRes.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = { success: false, error: 'CRM returned a non-JSON response' };
        }

        return jsonResponse(data, crmRes.status);
    } catch (err) {
        console.error('[paperwork-proxy]', err && err.message);
        return jsonResponse({
            success: false,
            error: 'Paperwork service is temporarily unavailable. Call (239) 332-2245.',
        }, 502);
    }
};

export const config = {
    path: '/api/paperwork',
};
