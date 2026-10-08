/**
 * Rate Limiter — IP-based sliding window using Netlify Blobs
 *
 * Uses the @netlify/blobs store "rate-limits" to track request counts
 * per IP per function within a 1-minute sliding window.
 *
 * Usage:
 *   const { allowed, remaining, resetAt } = await checkLimit(req, 'ai-concierge', 10);
 */
import { getStore } from '@netlify/blobs';

const WINDOW_MS = 60_000; // 1-minute window

/**
 * Check if a request is within the rate limit.
 *
 * @param {Request} req - The incoming request
 * @param {string} functionName - Name of the function (used as key prefix)
 * @param {number} maxRequests - Max requests allowed per window (default: 20)
 * @param {{ windowMs?: number, subject?: string, store?: { get: Function, set: Function } }} [options]
 *   subject replaces the IP in the key. store replaces the Netlify Blobs store.
 *   Existing callers keep a 60s window keyed by IP.
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
export async function checkLimit(req, functionName, maxRequests = 20, options) {
    const opts = options || {};
    const windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : WINDOW_MS;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-nf-client-connection-ip')
        || req.headers.get('client-ip')
        || 'unknown';
    const subject = opts.subject ? String(opts.subject) : ip;

    const key = `${functionName}:${subject}`;
    const now = Date.now();

    try {
        const store = opts.store || getStore('rate-limits');
        const raw = await store.get(key);

        let record = null;
        if (raw) {
            try {
                record = JSON.parse(raw);
            } catch {
                record = null;
            }
        }

        // If no record or window expired, start fresh
        if (!record || (now - record.windowStart) >= windowMs) {
            const newRecord = { count: 1, windowStart: now };
            await store.set(key, JSON.stringify(newRecord));
            return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
        }

        // Within the window — increment
        record.count += 1;

        if (record.count > maxRequests) {
            const resetAt = record.windowStart + windowMs;
            return { allowed: false, remaining: 0, resetAt };
        }

        await store.set(key, JSON.stringify(record));
        return {
            allowed: true,
            remaining: maxRequests - record.count,
            resetAt: record.windowStart + windowMs,
        };
    } catch (err) {
        // If Blobs service is down, fail open — don't block legitimate requests
        console.warn(`[rate-limiter] Blob store error (failing open): ${err.message}`);
        return { allowed: true, remaining: maxRequests, resetAt: now + windowMs };
    }
}
