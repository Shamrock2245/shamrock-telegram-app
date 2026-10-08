/**
 * Telegram Mini App signed-data checks.
 *
 * secret = HMAC_SHA256(key="WebAppData", message=bot token)
 * hash = HMAC_SHA256(key=secret, message=sorted key=value lines, excluding hash)
 * Fail closed when the token, hash or auth_date is missing or wrong.
 *
 * Two signed payloads use this scheme:
 *   - initData (Telegram.WebApp.initData): proves which Telegram user opened the Mini App.
 *   - the requestContact response (Telegram.WebApp.requestContact callback, `response.response`):
 *     proves the phone number Telegram holds for that user. Never trust `responseUnsafe`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SEC = 24 * 60 * 60;

export function verifyTelegramSignedQuery(raw, botToken, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = MAX_AGE_SEC) {
    const token = String(botToken || '').trim();
    const text = String(raw || '').trim();
    if (!token || !text) return { ok: false, error: 'missing_init_data' };

    const params = new URLSearchParams(text);
    const hash = params.get('hash') || '';
    if (!/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, error: 'missing_hash' };

    const pairs = [];
    for (const [key, value] of params.entries()) {
        if (key === 'hash') continue;
        pairs.push(`${key}=${value}`);
    }
    pairs.sort();
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const expected = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const givenBuf = Buffer.from(hash, 'hex');
    if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
        return { ok: false, error: 'bad_hash' };
    }

    const authDate = Number(params.get('auth_date') || 0);
    if (!Number.isFinite(authDate) || authDate <= 0 || Math.abs(nowSec - authDate) > maxAgeSec) {
        return { ok: false, error: 'stale_auth_date' };
    }
    return { ok: true, params };
}

function parseJsonParam(params, name) {
    try {
        return JSON.parse(params.get(name) || '{}') || {};
    } catch {
        return {};
    }
}

export function validateTelegramInitData(initData, botToken, nowSec = Math.floor(Date.now() / 1000)) {
    const checked = verifyTelegramSignedQuery(initData, botToken, nowSec);
    if (!checked.ok) return checked;
    const user = parseJsonParam(checked.params, 'user');
    const userId = user && user.id !== undefined && user.id !== null ? String(user.id).trim() : '';
    if (!userId) return { ok: false, error: 'missing_user' };
    return { ok: true, userId, user };
}

/** Last 10 digits of a phone number ('' when fewer than 10 digits). */
export function phone10(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Verify a signed requestContact response. Returns the Telegram user id and phone it proves.
 */
export function validateTelegramContact(contactResponse, botToken, nowSec = Math.floor(Date.now() / 1000)) {
    const checked = verifyTelegramSignedQuery(contactResponse, botToken, nowSec);
    if (!checked.ok) return { ok: false, error: 'contact_' + checked.error };
    const contact = parseJsonParam(checked.params, 'contact');
    const userId = contact && contact.user_id !== undefined && contact.user_id !== null ? String(contact.user_id).trim() : '';
    const phone = phone10(contact && contact.phone_number);
    if (!userId || !phone) return { ok: false, error: 'contact_incomplete' };
    return { ok: true, userId, phone };
}
