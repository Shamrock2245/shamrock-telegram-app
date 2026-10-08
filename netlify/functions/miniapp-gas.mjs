/**
 * Mini App → GAS proxy
 * POST /api/miniapp
 *
 * The Telegram Mini App pages call this instead of the public GAS /exec URL. It:
 *   1. Verifies Telegram initData (HMAC-SHA256 with TELEGRAM_BOT_TOKEN, fresh auth_date).
 *   2. For lookups, ALSO verifies the signed requestContact response (same HMAC scheme). The
 *      contact must belong to the same Telegram user, and the lookup runs ONLY on the phone
 *      Telegram verified for that user. A typed phone that differs, or a case-number lookup,
 *      is refused. Client-supplied phone, ids or names are never trusted for ownership.
 *   3. Only then forwards to GAS with apiKey = GAS_API_KEY (server-side, never returned).
 * Every refusal happens before any outbound call.
 *
 * Body: { action, initData, contact?, ...payload }
 *   Write actions: telegram_mini_app_intake, telegram_mini_app_upload, telegram_payment_log,
 *                  telegram_checkin_log, telegram_client_update
 *   Lookups (need `contact` = requestContact `response.response` string):
 *                  telegram_payment_lookup, telegram_status_lookup, telegram_document_lookup
 *
 * Env (names only): TELEGRAM_BOT_TOKEN, GAS_API_KEY, GAS_WEB_APP_URL.
 */
import { GAS_ENDPOINT, gasApiKey } from './shared/ai-client.mjs';
import { checkLimit } from './shared/rate-limiter.mjs';
import { validateTelegramInitData, validateTelegramContact, phone10 } from './shared/telegram-init-data.mjs';

export const WRITE_ACTIONS = [
    'telegram_mini_app_intake',
    'telegram_mini_app_upload',
    'telegram_payment_log',
    'telegram_checkin_log',
    'telegram_client_update',
];
export const LOOKUP_ACTIONS = ['telegram_payment_lookup', 'telegram_status_lookup', 'telegram_document_lookup'];

// Netlify synchronous functions accept request bodies up to 6 MB. GAS accepts 7,000,000
// base64 chars, so the pages shrink large photos before upload (shared/brand.js).
export const MAX_UPLOAD_BASE64 = 5_000_000;

// Fields the client may never set on what GAS receives; the proxy fills or drops them.
const STRIPPED = ['initData', 'contact', 'apiKey', 'telegramUserId', 'telegramUsername', 'telegramChatId', 'verifiedTelegramPhone'];

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

export function createMiniappHandler(deps = {}) {
    const fetchImpl = deps.fetchImpl || ((...args) => globalThis.fetch(...args));
    const rateStore = deps.rateStore;
    const nowSec = deps.nowSec || (() => Math.floor(Date.now() / 1000));

    return async (req) => {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
        if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

        let body;
        try {
            body = await req.json();
        } catch {
            return json({ success: false, error: 'invalid_json' }, 400);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ success: false, error: 'invalid_json' }, 400);

        const action = String(body.action || '');
        const isLookup = LOOKUP_ACTIONS.includes(action);
        if (!isLookup && !WRITE_ACTIONS.includes(action)) return json({ success: false, error: 'unknown_action' }, 400);

        // 1. Who is this? Telegram-signed initData only.
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const auth = validateTelegramInitData(body.initData, botToken, nowSec());
        if (!auth.ok) return json({ success: false, error: 'unauthorized' }, 401);

        const forward = {};
        for (const [k, v] of Object.entries(body)) if (!STRIPPED.includes(k)) forward[k] = v;

        if (isLookup) {
            // 2. Which phone does Telegram say this user owns?
            const contact = validateTelegramContact(body.contact, botToken, nowSec());
            if (!contact.ok) return json({ success: false, error: 'phone_not_verified', needContact: true }, 401);
            if (contact.userId !== auth.userId) return json({ success: false, error: 'contact_user_mismatch', needContact: true }, 403);
            if (body.caseNumber) return json({ success: false, error: 'case_number_lookup_not_allowed' }, 403);
            const typed = phone10(body.phone);
            if (body.phone && typed !== contact.phone) return json({ success: false, error: 'not_your_phone' }, 403);
            // Only the verified phone goes to GAS; every other client field is dropped.
            for (const k of Object.keys(forward)) delete forward[k];
            forward.action = action;
            forward.phone = contact.phone;
            forward.verifiedTelegramPhone = true;
            forward.source = 'telegram_mini_app';
        } else if (action === 'telegram_mini_app_upload') {
            const b64 = String(body.base64Data || '');
            if (!b64) return json({ success: false, error: 'missing_file' }, 400);
            if (b64.length > MAX_UPLOAD_BASE64) return json({ success: false, error: 'file_too_large' }, 413);
        }

        // Verified identity replaces anything the client claimed.
        const anonymous = action === 'telegram_client_update' && body.isAnonymous === true;
        forward.action = action;
        forward.telegramUserId = anonymous ? '' : auth.userId;
        forward.telegramUsername = anonymous ? '' : String((auth.user && auth.user.username) || '');
        if (action === 'telegram_mini_app_intake') forward.telegramChatId = auth.userId;

        // 3. Per-user rate limit (fails open if Blobs is down; GAS also limits intake/upload).
        const limit = await checkLimit(req, 'miniapp-' + (isLookup ? 'lookup' : 'write'), isLookup ? 10 : 30, {
            windowMs: 10 * 60 * 1000,
            subject: 'tg:' + auth.userId,
            ...(rateStore ? { store: rateStore } : {}),
        });
        if (!limit.allowed) return json({ success: false, error: 'rate_limited' }, 429);

        const key = gasApiKey();
        if (!key || GAS_ENDPOINT === 'MISSING_GAS_WEB_APP_URL') {
            console.error('[miniapp-gas] GAS_API_KEY or GAS_WEB_APP_URL not set');
            return json({ success: false, error: 'not_configured' }, 503);
        }
        forward.apiKey = key;

        // 4. Forward once to GAS.
        let res;
        try {
            res = await fetchImpl(GAS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(forward),
                redirect: 'follow',
            });
        } catch (err) {
            console.error('[miniapp-gas] GAS fetch failed:', err && err.message);
            return json({ success: false, error: 'gas_unreachable' }, 502);
        }
        let data;
        try {
            data = await res.json();
        } catch {
            data = { success: res.ok, _opaque: true };
        }
        if (data && typeof data === 'object') delete data.apiKey;
        return json(data, res.ok ? 200 : 502);
    };
}

export default createMiniappHandler();

export const config = {
    path: '/api/miniapp',
};
