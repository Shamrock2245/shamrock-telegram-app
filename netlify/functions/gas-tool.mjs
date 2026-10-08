/**
 * /api/gas-tool — Netlify relay for ElevenLabs tools that still call GAS
 * with ?secret= in the URL. Sibling of /api/shannon-tool. Does not share
 * that allowlist or its inbound Bearer.
 *
 * Inert until Netlify env EL_TOOL_RELAY_SECRET is set: every request then
 * returns 503 relay_misconfigured and nothing is forwarded. This module
 * does not change ElevenLabs tool URLs, methods, or other Netlify routes.
 *
 * Allowlist (phase 1): the 13 tools agents use against GAS /exec.
 * Not listed (other routes): send_sms, schedule_callback,
 * check_caller_history, notify_bondsman.
 *
 * Env (names only):
 *   EL_TOOL_RELAY_SECRET     — Bearer ElevenLabs sends (required; fail closed)
 *   ELEVENLABS_TOOL_SECRET   — if set, added as ?secret= on the GAS URL (optional)
 *   GAS_WEB_APP_URL          — GAS /exec URL (canonical; GAS_ENDPOINT is the legacy alias)
 *
 * The caller cannot supply ?secret= or a GAS URL. Only this server appends
 * the outbound secret, and only from ELEVENLABS_TOOL_SECRET.
 */
import { timingSafeEqual } from 'node:crypto';
import { GAS_ENDPOINT } from './shared/ai-client.mjs';

export const config = { path: '/api/gas-tool' };

export const ALLOWED_TOOLS = Object.freeze([
    'lookup_defendant',
    'check_inmate_status',
    'calculate_premium',
    'create_intake',
    'send_payment_link',
    'check_client_account',
    'save_paperwork_answers',
    'email_paperwork_to_indemnitor',
    'request_id_photo',
    'check_id_upload',
    'schedule_office_visit',
    'transfer_to_bondsman',
    'send_paperwork',
]);

export const MAX_BODY_BYTES = 64 * 1024;

const GAS_HOST_RE = /script\.google(?:usercontent)?\.com/i;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

// Tool name + status only. Allowlisted names are a fixed set; anything else
// is logged as "-" so a query or body cannot land in the log line.
function logStatus(tool, status) {
    const name = ALLOWED_TOOLS.includes(tool) ? tool : '-';
    const line = '[gas-tool] tool=' + name + ' status=' + String(status);
    if (status >= 400) console.error(line);
    else console.info(line);
}

function finish(tool, payload, status) {
    logStatus(tool, status);
    return json(payload, status);
}

function bearerOk(header, expected) {
    if (!expected) return false;
    const raw = String(header || '');
    const provided = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function textHasGasUrl(value) {
    let current = String(value ?? '');
    for (let i = 0; i < 2; i++) {
        if (GAS_HOST_RE.test(current)) return true;
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current) break;
            current = decoded;
        } catch {
            break;
        }
    }
    return GAS_HOST_RE.test(current);
}

function inboundSecretParam(url) {
    for (const key of url.searchParams.keys()) {
        if (String(key).toLowerCase() === 'secret') return true;
    }
    return /(?:^|[?&])secret=/i.test(url.search);
}

function queryHasGasUrl(url) {
    if (textHasGasUrl(url.search)) return true;
    for (const value of url.searchParams.values()) {
        if (textHasGasUrl(value)) return true;
    }
    return false;
}

function jsonHasGasUrl(value) {
    const stack = [value];
    let seen = 0;
    while (stack.length) {
        if (++seen > 10000) return true;
        const cur = stack.pop();
        if (typeof cur === 'string') {
            if (textHasGasUrl(cur)) return true;
            continue;
        }
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
            for (const item of cur) stack.push(item);
            continue;
        }
        for (const [key, nested] of Object.entries(cur)) {
            if (textHasGasUrl(key)) return true;
            stack.push(nested);
        }
    }
    return false;
}

export function createGasToolHandler({ fetchImpl = fetch } = {}) {
    return async (req) => {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        let requestUrl = null;
        try {
            requestUrl = new URL(req.url);
        } catch {
            requestUrl = null;
        }
        const tool = requestUrl ? String(requestUrl.searchParams.get('tool') || '').trim() : '';

        if (req.method !== 'POST') {
            return finish(tool, { success: false, error: 'method_not_allowed' }, 405);
        }

        const inboundSecret = String(process.env.EL_TOOL_RELAY_SECRET || '').trim();
        if (!inboundSecret) {
            return finish(tool, { success: false, error: 'relay_misconfigured' }, 503);
        }
        if (!bearerOk(req.headers.get('authorization'), inboundSecret)) {
            return finish(tool, { success: false, error: 'unauthorized' }, 401);
        }

        if (GAS_ENDPOINT === 'MISSING_GAS_WEB_APP_URL') {
            return finish(tool, { success: false, error: 'relay_misconfigured' }, 503);
        }

        // Caller must not choose the GAS host or attach ?secret=.
        // Checked before the allowlist so a smuggled URL is never forwarded.
        if (!requestUrl || inboundSecretParam(requestUrl)) {
            return finish(tool, { success: false, error: 'inbound_secret_rejected' }, 400);
        }
        if (queryHasGasUrl(requestUrl)) {
            return finish(tool, { success: false, error: 'gas_url_rejected' }, 400);
        }

        if (!ALLOWED_TOOLS.includes(tool)) {
            return finish(tool, { success: false, error: 'tool_not_allowed' }, 400);
        }

        const contentLength = Number(req.headers.get('content-length') || 0);
        if (contentLength > MAX_BODY_BYTES) {
            return finish(tool, { success: false, error: 'body_too_large' }, 413);
        }

        let rawBody;
        try {
            rawBody = await req.text();
        } catch {
            return finish(tool, { success: false, error: 'invalid_body' }, 400);
        }
        if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
            return finish(tool, { success: false, error: 'body_too_large' }, 413);
        }
        if (textHasGasUrl(rawBody)) {
            return finish(tool, { success: false, error: 'gas_url_rejected' }, 400);
        }
        if (!rawBody.trim()) {
            return finish(tool, { success: false, error: 'empty_body' }, 400);
        }

        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            return finish(tool, { success: false, error: 'invalid_json' }, 400);
        }
        if (jsonHasGasUrl(parsed)) {
            return finish(tool, { success: false, error: 'gas_url_rejected' }, 400);
        }

        // Append ?secret= only when Netlify has ELEVENLABS_TOOL_SECRET.
        // Unset is allowed: GAS may still be in activation mode.
        const toolSecret = String(process.env.ELEVENLABS_TOOL_SECRET || '').trim();

        let gasUrl;
        try {
            gasUrl = new URL(GAS_ENDPOINT);
        } catch {
            return finish(tool, { success: false, error: 'relay_misconfigured' }, 503);
        }
        gasUrl.searchParams.set('source', 'elevenlabs_tool');
        gasUrl.searchParams.set('tool', tool);
        if (toolSecret) gasUrl.searchParams.set('secret', toolSecret);

        let gasRes;
        try {
            gasRes = await fetchImpl(gasUrl.toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: rawBody,
                redirect: 'follow',
                signal: AbortSignal.timeout(9000),
            });
        } catch {
            return finish(tool, { success: false, error: 'gas_unreachable' }, 502);
        }

        const text = await gasRes.text();
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            payload = { status: 'error', message: 'Upstream returned non-JSON' };
        }
        const status = gasRes.ok ? 200 : 502;
        logStatus(tool, status);
        return new Response(JSON.stringify(payload), {
            status,
            headers: { 'Content-Type': 'application/json', ...CORS },
        });
    };
}

export default createGasToolHandler();
