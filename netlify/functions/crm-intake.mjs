/**
 * Server-side intake for the Telegram mini-app.
 * Scans an ID when one was uploaded, then POST /api/intake/submit.
 * The existing GAS queue runs only when that call fails.
 */
import {
    buildCrmIntakeBody,
    scanIdImage,
    submitCrmIntake,
} from './shared/crm-intake.mjs';
import { checkLimit } from './shared/rate-limiter.mjs';
import { validateTelegramInitData } from './shared/telegram-init-data.mjs';

const INTAKE_LIMIT = 20;
const INTAKE_WINDOW_MS = 10 * 60 * 1000;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS });
}

function sourceFor(body) {
    const raw = String((body && body.source) || '').toLowerCase();
    if (raw === 'shannon_voice' || raw.indexOf('shannon') !== -1) return 'shannon_voice';
    if (raw.indexOf('mini') !== -1) return 'telegram_miniapp';
    return 'telegram';
}

function configuredGasUrl() {
    const url = String(process.env.GAS_WEB_APP_URL || process.env.GAS_ENDPOINT || '').trim();
    if (!url || url === 'MISSING_GAS_WEB_APP_URL') return '';
    return url;
}

async function gasFallback(body) {
    const payload = { ...(body || {}) };
    delete payload.id_image_b64;
    delete payload.id_filename;
    delete payload.initData;
    // Match the browser GAS payload: underscore source and the surety the sheet expects.
    payload.action = 'telegram_mini_app_intake';
    payload.source = 'telegram_mini_app';
    payload.surety_id = payload.surety_id || 'osi';
    const gasUrl = configuredGasUrl();
    if (!gasUrl) {
        console.error('[crm-intake] GAS fallback unavailable: GAS_WEB_APP_URL is not set');
        return { ok: false, error: 'missing_gas_url', gas_available: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            redirect: 'follow',
            signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
            console.error('[crm-intake] GAS fallback failed status=' + response.status);
            return { ok: false, error: 'gas_http_' + response.status, gas_available: true };
        }
        try {
            return { ok: true, body: JSON.parse(text) };
        } catch {
            return { ok: true, body: { success: true } };
        }
    } catch (err) {
        console.error('[crm-intake] GAS fallback failed error=' + (err && err.message));
        return { ok: false, error: err && err.message ? err.message : 'gas_network', gas_available: true };
    } finally {
        clearTimeout(timer);
    }
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    if (!body || typeof body !== 'object') return json({ success: false, error: 'Empty body' }, 400);

    const auth = validateTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!auth.ok) return json({ success: false, error: 'Unauthorized' }, 401);

    const limit = await checkLimit(req, 'crm-intake', INTAKE_LIMIT, {
        windowMs: INTAKE_WINDOW_MS,
        subject: 'tg:' + auth.userId,
        ...(req.__rateStore ? { store: req.__rateStore } : {}),
    });
    if (!limit.allowed) return json({ success: false, error: 'Too many requests' }, 429);

    const source = sourceFor(body);
    let scan = {};
    if (body.id_image_b64) {
        try {
            scan = await scanIdImage(body.id_image_b64, body.id_filename || 'id.jpg');
        } catch (err) {
            console.error('[crm-intake] ID scan failed error=' + (err && err.message));
            scan = {};
        }
    }

    const payload = buildCrmIntakeBody(source, {
        form: body,
        scan,
        intakeId: body.intakeId || body.intake_id || '',
    });
    const crm = await submitCrmIntake(payload);
    if (crm.ok) {
        return json({
            success: true,
            via: 'crm',
            source: crm.source,
            intake_id: crm.intake_id,
        });
    }

    console.error('[crm-intake] CRM submit failed; using GAS fallback source=' + source + ' error=' + crm.error);
    const gas = await gasFallback(body);
    if (gas.ok) {
        return json({
            success: true,
            via: 'gas_fallback',
            source,
            intake_id: payload.intakeId || '',
            gas: gas.body || null,
        });
    }
    const gasAvailable = gas.gas_available !== false && gas.error !== 'missing_gas_url';
    return json({
        success: false,
        via: 'failed',
        fallback_attempted: gasAvailable,
        gas_available: gasAvailable,
        source,
        error: crm.error || gas.error || 'intake_failed',
    }, 502);
}

export const config = {
    path: '/api/crm-intake',
};
