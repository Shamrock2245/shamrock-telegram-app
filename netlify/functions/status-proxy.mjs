/**
 * Status Proxy — Cached GAS Status Lookups via Netlify Blobs
 * POST /api/status
 *
 * Body: { phone: string, action?: string }
 * Returns: Cached GAS response (5-min TTL)
 */
import { getStore } from '@netlify/blobs';
import { GAS_ENDPOINT, CORS_HEADERS, handleOptions, errorResponse, jsonResponse, parseBody } from './shared/ai-client.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const body = await parseBody(req);
    if (!body?.phone) {
        return errorResponse('Missing phone number', 400);
    }

    const phone = body.phone.replace(/\D/g, '');
    const action = body.action || 'telegram_status_lookup';
    const cacheKey = `status_${phone}_${action}`;

    try {
        // Try cache first
        const store = getStore('status-cache');

        try {
            const cached = await store.get(cacheKey, { type: 'json' });
            if (cached && cached._cachedAt && (Date.now() - cached._cachedAt) < CACHE_TTL_MS) {
                return jsonResponse({ ...cached, _fromCache: true });
            }
        } catch {
            // Cache miss — continue to GAS
        }

        // Fetch from GAS
        const gasResponse = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, phone }),
            redirect: 'follow',
        });

        let data;
        try {
            data = await gasResponse.json();
        } catch {
            data = { success: true, _opaque: true };
        }

        // Cache the result
        try {
            await store.setJSON(cacheKey, { ...data, _cachedAt: Date.now() });
        } catch (cacheErr) {
            console.warn('[status-proxy] Cache write failed:', cacheErr.message);
        }

        return jsonResponse({ ...data, _fromCache: false });
    } catch (err) {
        console.error('[status-proxy] Error:', err.message);
        return errorResponse('Status lookup failed: ' + err.message);
    }
};
