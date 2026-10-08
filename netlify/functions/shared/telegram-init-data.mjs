/**
 * Telegram Mini App initData check.
 *
 * secret = HMAC_SHA256(key="WebAppData", message=bot token)
 * hash = HMAC_SHA256(key=secret, message=sorted key=value lines, excluding hash)
 * Fail closed when the token, hash, user id, or auth_date is missing or wrong.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SEC = 24 * 60 * 60;

export function validateTelegramInitData(initData, botToken, nowSec = Math.floor(Date.now() / 1000)) {
    const token = String(botToken || '').trim();
    const raw = String(initData || '').trim();
    if (!token || !raw) return { ok: false, error: 'missing_init_data' };

    const params = new URLSearchParams(raw);
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
    if (!Number.isFinite(authDate) || authDate <= 0 || Math.abs(nowSec - authDate) > MAX_AGE_SEC) {
        return { ok: false, error: 'stale_auth_date' };
    }

    let user = {};
    try {
        user = JSON.parse(params.get('user') || '{}');
    } catch {
        user = {};
    }
    const userId = user && user.id !== undefined && user.id !== null ? String(user.id).trim() : '';
    if (!userId) return { ok: false, error: 'missing_user' };
    return { ok: true, userId, user };
}
