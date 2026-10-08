/**
 * Status Proxy — RETIRED (2026-10-08)
 * POST /api/status
 *
 * This was an unauthenticated proxy that forwarded any phone (and any `action`) to GAS and
 * cached the client data it returned. No page called it. Status lookups now go through
 * /api/miniapp, which verifies Telegram initData and the caller's Telegram-verified phone.
 * It returns 410 and makes no outbound call.
 */
export default async () => new Response(JSON.stringify({ success: false, error: 'retired', use: '/api/miniapp' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
