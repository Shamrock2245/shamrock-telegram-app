/**
 * Check-In Geo Alert — POST Endpoint
 * POST /api/checkin-geo-alert
 *
 * Compares check-in GPS coordinates against the defendant's home county to detect
 * abnormal movement (>50 miles from home).
 *
 * AUTH (required; checked before any outbound call). Either:
 *   - Server callers: header `X-GAS-API-Key` equal to the Netlify env var GAS_API_KEY
 *     (the same shared secret GAS holds as its GAS_API_KEY Script Property), or
 *   - Telegram mini-app: body.initData (Telegram.WebApp.initData) whose HMAC-SHA256 verifies
 *     against the Netlify env var TELEGRAM_BOT_TOKEN, with a fresh auth_date.
 * Anything else gets 401 and no Slack post. Without auth, anyone could push fake
 * geo-fence alerts into #alerts.
 * As of 2026-10-08 no repo calls this endpoint (the old comment said GAS did, but GAS has no
 * such call), so requiring auth breaks no live caller.
 *
 * Body: {
 *   caseNumber: string,
 *   defendantName: string,
 *   latitude: number,
 *   longitude: number,
 *   homeCounty: string,        // e.g. "lee", "collier"
 *   phone: string
 * }
 *
 * Returns: { alert: boolean, distance: number, message: string }
 *
 * If distance > 50 miles, posts a Slack alert and returns alert: true.
 * No AI needed — pure Haversine math.
 */
import { timingSafeEqual } from 'node:crypto';
import { GAS_ENDPOINT, gasApiKey, handleOptions, errorResponse, jsonResponse, parseBody } from './shared/ai-client.mjs';
import { validateTelegramInitData } from './shared/telegram-init-data.mjs';

// Server callers: X-GAS-API-Key must equal GAS_API_KEY. Fails closed when the env var is unset.
function hasServerKey(req) {
    const expected = gasApiKey();
    const given = String(req.headers.get('x-gas-api-key') || '').trim();
    if (!expected || !given) return false;
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeGeoAlert(req, body) {
    if (hasServerKey(req)) return { ok: true, via: 'server_key' };
    const tg = validateTelegramInitData(body && body.initData, process.env.TELEGRAM_BOT_TOKEN);
    if (tg.ok) return { ok: true, via: 'telegram_init_data', userId: tg.userId };
    return { ok: false };
}

// County center coordinates (approximate centers of each served county)
const COUNTY_CENTERS = {
    'lee': { lat: 26.6406, lng: -81.8723, name: 'Lee County' },
    'collier': { lat: 26.1174, lng: -81.4014, name: 'Collier County' },
    'charlotte': { lat: 26.9342, lng: -82.0784, name: 'Charlotte County' },
    'hendry': { lat: 26.5559, lng: -81.0260, name: 'Hendry County' },
    'glades': { lat: 26.8843, lng: -81.0712, name: 'Glades County' },
    'sarasota': { lat: 27.1860, lng: -82.3618, name: 'Sarasota County' },
    'desoto': { lat: 27.1731, lng: -81.8103, name: 'DeSoto County' },
};

// Alert threshold in miles
const ALERT_DISTANCE_MILES = 50;

/**
 * Haversine distance between two GPS points (returns miles)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth radius in miles
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function toRad(deg) { return deg * (Math.PI / 180); }

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const body = await parseBody(req);
    // Auth before anything else: no Slack post, GAS call or other fetch without it.
    if (!authorizeGeoAlert(req, body).ok) {
        return errorResponse('Unauthorized', 401);
    }
    if (!body?.latitude || !body?.longitude) {
        return errorResponse('Missing latitude/longitude', 400);
    }

    const homeCounty = (body.homeCounty || '').toLowerCase().trim();
    const center = COUNTY_CENTERS[homeCounty];

    // If no home county match, can't do geo-fencing — pass through
    if (!center) {
        console.log(`[geo-alert] Unknown home county "${homeCounty}" for case ${body.caseNumber} — skipping`);
        return jsonResponse({
            alert: false,
            distance: null,
            message: `Home county "${homeCounty}" not in served area — geo-fencing skipped`,
        });
    }

    // Calculate distance from check-in location to home county center
    const distance = haversineDistance(body.latitude, body.longitude, center.lat, center.lng);
    const distanceRounded = Math.round(distance * 10) / 10;

    console.log(`[geo-alert] ${body.defendantName} checked in ${distanceRounded} mi from ${center.name}`);

    if (distance <= ALERT_DISTANCE_MILES) {
        return jsonResponse({
            alert: false,
            distance: distanceRounded,
            message: `Check-in within ${ALERT_DISTANCE_MILES}mi of ${center.name} ✓`,
        });
    }

    // 🚨 ALERT — Defendant is outside safe zone
    const googleMapsUrl = `https://www.google.com/maps?q=${body.latitude},${body.longitude}`;
    const slackMessage = [
        `🚨 *GEO-FENCE ALERT — ABNORMAL MOVEMENT*`,
        ``,
        `*Defendant:* ${body.defendantName || 'Unknown'}`,
        `*Case:* ${body.caseNumber || 'N/A'}`,
        `*Home County:* ${center.name}`,
        `*Check-In Location:* ${body.latitude.toFixed(4)}, ${body.longitude.toFixed(4)}`,
        `*Distance from Home:* 📏 ${distanceRounded} miles`,
        `*Threshold:* ${ALERT_DISTANCE_MILES} miles`,
        ``,
        `📍 <${googleMapsUrl}|View on Google Maps>`,
        ``,
        `⚠️ Defendant checked in *${distanceRounded} miles* from their home county. Investigate immediately.`,
    ].join('\n');

    // Post alert to Slack via GAS
    try {
        await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'post_slack_message',
                apiKey: gasApiKey(),
                channel: '#alerts',
                message: slackMessage,
            }),
            redirect: 'follow',
        });
    } catch (err) {
        console.warn('[geo-alert] Slack alert failed:', err.message);
    }

    return jsonResponse({
        alert: true,
        distance: distanceRounded,
        homeCounty: center.name,
        message: `⚠️ ${body.defendantName} is ${distanceRounded} miles from ${center.name}`,
        mapsUrl: googleMapsUrl,
    });
};
