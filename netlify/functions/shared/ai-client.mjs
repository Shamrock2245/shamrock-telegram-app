/**
 * Shared AI client factory for Netlify Functions
 * Uses OpenAI SDK for both OpenAI and Grok (xAI) — they share the same API format.
 *
 * Environment variables (set in Netlify dashboard):
 *   OPENAI_API_KEY  — OpenAI key (auto-injected by AI Gateway on Netlify)
 *   GROK_API_KEY    — xAI / Grok key
 *   GAS_ENDPOINT    — Google Apps Script web app URL
 */
import OpenAI from 'openai';
import { checkLimit } from './rate-limiter.mjs';

// Re-export for direct use
export { checkLimit };

// ── Rate limit guard — returns a 429 Response if exceeded, or null if OK
export async function checkRateLimit(req, functionName, maxRequests = 20) {
    const { allowed, remaining, resetAt } = await checkLimit(req, functionName, maxRequests);
    if (!allowed) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        return new Response(JSON.stringify({
            error: 'Too many requests. Please try again shortly.',
            retryAfter,
        }), {
            status: 429,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json',
                'Retry-After': String(retryAfter),
                'X-RateLimit-Limit': String(maxRequests),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
            },
        });
    }
    return null; // Allowed — proceed
}

// ── OpenAI client (auto-uses OPENAI_API_KEY + OPENAI_BASE_URL if AI Gateway is on)
export function getOpenAI() {
    return new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key',
        ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
    });
}

// ── Grok / xAI client (OpenAI-compatible endpoint)
export function getGrok() {
    return new OpenAI({
        apiKey: process.env.GROK_API_KEY || process.env.OPENAI_API_KEY || 'missing-grok-key',
        baseURL: 'https://api.x.ai/v1',
    });
}

// ── GAS endpoint
// GAS_WEB_APP_URL is the canonical env var; GAS_ENDPOINT is the legacy alias.
// Set GAS_WEB_APP_URL in Netlify dashboard — one value, all functions.
export const GAS_ENDPOINT = process.env.GAS_WEB_APP_URL
    || process.env.GAS_ENDPOINT
    || 'https://script.google.com/macros/s/AKfycbyCIDPzA_EA1B1SGsfhYiXRGKM8z61EgACZdDPILT_MjjXee0wSDEI0RRYthE0CvP-Z/exec';

// ── CORS headers for Telegram WebView
export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Standard JSON response
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

// ── OPTIONS preflight handler
export function handleOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── Error response
export function errorResponse(message, status = 500) {
    return jsonResponse({ error: message }, status);
}

// ── Parse request body safely
export async function parseBody(req) {
    try {
        return await req.json();
    } catch {
        return null;
    }
}
