/**
 * /api/shannon-tool — Netlify relay for Shannon mid-call tools that can't put
 * secrets in a URL header ElevenLabs would send (GAS never receives headers).
 *
 * Allowlist: send_sms, schedule_callback, check_caller_history.
 * evaluate_flight_risk and run_background_verification are NOT listed: they have
 * no GAS handler and return "Unknown tool".
 *
 * Env (names only):
 *   SHANNON_TOOL_SECRET    — Bearer token ElevenLabs sends (required; fail closed)
 *   ELEVENLABS_TOOL_SECRET — if set, added as ?secret= when forwarding to GAS (optional)
 *   GAS_WEB_APP_URL          — GAS /exec URL (canonical; GAS_ENDPOINT is the legacy alias)
 *
 * Why SHANNON_TOOL_SECRET (new) instead of SEND_PAPERWORK_SECRET:
 *   notify-bondsman / send-paperwork share SEND_PAPERWORK_SECRET. This relay is a
 *   different surface (SMS + history + callbacks). A dedicated name can be rotated
 *   without touching those tools, and fail-closed is clearer than the older
 *   "if unset, allow" pattern on notify-bondsman.
 */
import { timingSafeEqual } from 'node:crypto';
import { GAS_ENDPOINT } from './shared/ai-client.mjs';

export const config = { path: '/api/shannon-tool' };

export const ALLOWED_TOOLS = Object.freeze(['send_sms', 'schedule_callback', 'check_caller_history']);
export const MAX_BODY_BYTES = 64 * 1024; // tool payloads are small; Netlify sync cap is 6 MB

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

function bearerOk(header, expected) {
    if (!expected) return false;
    const raw = String(header || '');
    const provided = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function createShannonToolHandler({ fetchImpl = fetch } = {}) {
    return async (req) => {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }
        if (req.method !== 'POST') {
            return json({ success: false, error: 'method_not_allowed' }, 405);
        }

        const inboundSecret = String(process.env.SHANNON_TOOL_SECRET || '').trim();
        if (!inboundSecret) {
            console.error('[shannon-tool] SHANNON_TOOL_SECRET not set');
            return json({ success: false, error: 'relay_misconfigured' }, 503);
        }
        if (!bearerOk(req.headers.get('authorization'), inboundSecret)) {
            return json({ success: false, error: 'unauthorized' }, 401);
        }

        if (GAS_ENDPOINT === 'MISSING_GAS_WEB_APP_URL') {
            console.error('[shannon-tool] GAS_WEB_APP_URL not set');
            return json({ success: false, error: 'relay_misconfigured' }, 503);
        }
        // Append ?secret= only when Netlify has ELEVENLABS_TOOL_SECRET. Unset is allowed:
        // GAS may still be in activation mode, or Brendan may set the Script Property later.
        const toolSecret = String(process.env.ELEVENLABS_TOOL_SECRET || '').trim();

        const url = new URL(req.url);
        const tool = String(url.searchParams.get('tool') || '').trim();
        if (!ALLOWED_TOOLS.includes(tool)) {
            return json({ success: false, error: 'tool_not_allowed' }, 400);
        }

        const contentLength = Number(req.headers.get('content-length') || 0);
        if (contentLength > MAX_BODY_BYTES) {
            return json({ success: false, error: 'body_too_large' }, 413);
        }

        let rawBody;
        try {
            rawBody = await req.text();
        } catch {
            return json({ success: false, error: 'invalid_body' }, 400);
        }
        if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
            return json({ success: false, error: 'body_too_large' }, 413);
        }
        if (!rawBody.trim()) {
            return json({ success: false, error: 'empty_body' }, 400);
        }
        try {
            JSON.parse(rawBody);
        } catch {
            return json({ success: false, error: 'invalid_json' }, 400);
        }

        const gasUrl = new URL(GAS_ENDPOINT);
        gasUrl.searchParams.set('source', 'elevenlabs_tool');
        gasUrl.searchParams.set('tool', tool);
        if (toolSecret) gasUrl.searchParams.set('secret', toolSecret);
        // Never log gasUrl: it may carry the secret.

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
        } catch (err) {
            console.error('[shannon-tool] GAS fetch failed:', err && err.name);
            return json({ success: false, error: 'gas_unreachable' }, 502);
        }

        const text = await gasRes.text();
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            payload = { status: 'error', message: 'Upstream returned non-JSON' };
        }
        return new Response(JSON.stringify(payload), {
            status: gasRes.ok ? 200 : 502,
            headers: { 'Content-Type': 'application/json', ...CORS },
        });
    };
}

export default createShannonToolHandler();
