/**
 * Server-side intake for the Telegram mini-app.
 * Scans an ID when one was uploaded, then POST /api/intake/submit.
 * A CRM failure returns JSON immediately. The browser saves through GAS.
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

    console.error('[crm-intake] CRM submit failed source=' + source + ' error=' + crm.error);
    return json({
        success: false,
        via: 'crm_failed',
        error: 'crm_failed',
        source,
    }, 502);
}

export const config = {
    path: '/api/crm-intake',
};
