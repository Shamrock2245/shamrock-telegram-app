/**
 * Shamrock Bail Bonds — Shared Brand Utilities
 * Common theme toggle, Telegram SDK initialization, and helpers
 * Imported by all Mini Apps.
 */

// ═══════════════════════════════════════════════════════════════
// TELEGRAM SDK INIT
// ═══════════════════════════════════════════════════════════════

var tg = window.Telegram?.WebApp || null;
var tgUser = tg?.initDataUnsafe?.user || null;
var tgInitData = tg?.initData || '';

function initTelegram() {
    if (!tg) {
        console.warn('Telegram WebApp SDK not available — running in browser mode');
        return false;
    }
    tg.expand();
    tg.enableClosingConfirmation();
    tg.ready();
    return true;
}

// ═══════════════════════════════════════════════════════════════
// THEME MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function initTheme() {
    const saved = localStorage.getItem('shamrock-theme');
    const theme = saved || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('shamrock-theme', next);
    if (tg) tg.HapticFeedback.impactOccurred('light');
}

// ═══════════════════════════════════════════════════════════════
// COMMON HELPERS
// ═══════════════════════════════════════════════════════════════

function formatPhone(value) {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return phone.replace(/\D/g, '').length === 10;
}

// ═══════════════════════════════════════════════════════════════
// GAS ENDPOINT CONFIG
// ═══════════════════════════════════════════════════════════════

const SHAMROCK_GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyCIDPzA_EA1B1SGsfhYiXRGKM8z61EgACZdDPILT_MjjXee0wSDEI0RRYthE0CvP-Z/exec';
const SHAMROCK_PHONE = '(239) 332-2245';
const SHAMROCK_PAYMENT_LINK = 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8';

// ═══════════════════════════════════════════════════════════════
// GAS FETCH HELPER — replaces all no-cors fire-and-forget patterns
// Uses Content-Type: text/plain to avoid CORS preflight on GAS doPost.
// Returns parsed JSON or throws on network/server error.
// ═══════════════════════════════════════════════════════════════
async function gasPost(endpoint, payload) {
    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
        redirect: 'follow'
    });
    if (!resp.ok) {
        throw new Error('Server error ' + resp.status);
    }
    try {
        return await resp.json();
    } catch (e) {
        // GAS sometimes returns non-JSON on redirect — treat as success
        return { success: true, _opaque: true };
    }
}

// ═══════════════════════════════════════════════════════════════
// TIERED LOCATION CAPTURE — shared across intake, payment, defendant
//
// Usage:
//   captureLocationTiered({
//     onSuccess: (lat, lng, source) => { ... },
//     onManualFallback: () => { ... },   // show manual city/zip input
//     onStatusUpdate: (msg) => { ... }   // optional progress text
//   });
//
// Sources: 'telegram' | 'coarse' | 'gps'
//
// Strategy: Race all available methods in parallel.
//   - Telegram LocationManager (3s timeout)
//   - Browser coarse + GPS race simultaneously
//   - First valid result wins, rest are ignored.
//   - Total max wall-clock: ~5s before fallback.
// ═══════════════════════════════════════════════════════════════
async function captureLocationTiered({ onSuccess, onManualFallback, onStatusUpdate }) {
    let resolved = false;
    const done = (lat, lng, source) => {
        if (resolved) return;
        resolved = true;
        if (_locHeartbeat) clearInterval(_locHeartbeat);
        onSuccess(lat, lng, source);
    };
    const status = (msg) => { if (!resolved && onStatusUpdate) onStatusUpdate(msg); };

    // Progress heartbeat — shows dots so user knows it's alive
    let _locDots = 0;
    var _locHeartbeat = setInterval(() => {
        if (resolved) { clearInterval(_locHeartbeat); return; }
        _locDots = (_locDots + 1) % 4;
        status('Getting location' + '.'.repeat(_locDots + 1));
    }, 400);

    status('Getting location…');

    // Helper: wrap getCurrentPosition in a promise with a hard timeout
    function geoPromise(highAccuracy, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) { reject(new Error('no geolocation')); return; }
            const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs + 500);
            navigator.geolocation.getCurrentPosition(
                (pos) => { clearTimeout(timer); resolve(pos); },
                (err) => { clearTimeout(timer); reject(err); },
                {
                    enableHighAccuracy: highAccuracy,
                    timeout: timeoutMs,
                    maximumAge: highAccuracy ? 0 : 300000
                }
            );
        });
    }

    // Build race candidates
    const candidates = [];

    // CANDIDATE 1: Telegram LocationManager (3s hard timeout)
    if (window.Telegram?.WebApp?.LocationManager) {
        candidates.push(
            new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('TG timeout')), 3000);
                try {
                    window.Telegram.WebApp.LocationManager.init(() => {
                        window.Telegram.WebApp.LocationManager.getLocation((result) => {
                            clearTimeout(timer);
                            if (result) resolve({ lat: result.latitude, lng: result.longitude, source: 'telegram' });
                            else reject(new Error('TG denied'));
                        });
                    });
                } catch (e) { clearTimeout(timer); reject(e); }
            })
        );
    }

    // CANDIDATE 2: Coarse (network/IP — fast, ~1s)
    if (navigator.geolocation) {
        candidates.push(
            geoPromise(false, 3000).then(pos => ({
                lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'coarse'
            }))
        );
    }

    // CANDIDATE 3: High-accuracy GPS (mobile, ~2-5s)
    if (navigator.geolocation) {
        candidates.push(
            geoPromise(true, 5000).then(pos => ({
                lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps'
            }))
        );
    }

    if (candidates.length === 0) {
        clearInterval(_locHeartbeat);
        if (onManualFallback) onManualFallback();
        return;
    }

    // Race: first valid result wins
    // Promise.any rejects only if ALL candidates fail
    try {
        const winner = await Promise.any(candidates);
        done(winner.lat, winner.lng, winner.source);
    } catch (e) {
        // All candidates failed
        console.log('[location] All tiers failed:', e.message || e);
        clearInterval(_locHeartbeat);
        if (onManualFallback) onManualFallback();
    }
}

// ═══════════════════════════════════════════════════════════════
// SESSION PERSISTENCE HELPERS
// Saves/restores partial form state to sessionStorage so users
// don't lose progress if they accidentally close the mini app.
// ═══════════════════════════════════════════════════════════════
function saveFormSession(key, data) {
    try {
        sessionStorage.setItem('shamrock_' + key, JSON.stringify(data));
    } catch (e) { /* quota or private mode — silent */ }
}
function loadFormSession(key) {
    try {
        const raw = sessionStorage.getItem('shamrock_' + key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}
function clearFormSession(key) {
    try { sessionStorage.removeItem('shamrock_' + key); } catch (e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════
// DEBOUNCE UTILITY
// ═══════════════════════════════════════════════════════════════
function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}
