/**
 * Shamrock Bail Bonds — Shared Brand Utilities
 * Common theme toggle, Telegram SDK initialization, and helpers
 * Imported by all Mini Apps.
 */

// ═══════════════════════════════════════════════════════════════
// TELEGRAM SDK INIT
// ═══════════════════════════════════════════════════════════════

const tg = window.Telegram?.WebApp;
const tgUser = tg?.initDataUnsafe?.user;
const tgInitData = tg?.initData || '';

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

const SHAMROCK_GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec';
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
// ═══════════════════════════════════════════════════════════════
async function captureLocationTiered({ onSuccess, onManualFallback, onStatusUpdate }) {
    const status = (msg) => { if (onStatusUpdate) onStatusUpdate(msg); };

    // TIER 1: Telegram LocationManager (fastest in mobile Telegram)
    if (window.Telegram?.WebApp?.LocationManager) {
        try {
            status('Requesting Telegram location…');
            const loc = await new Promise((resolve, reject) => {
                window.Telegram.WebApp.LocationManager.init(() => {
                    window.Telegram.WebApp.LocationManager.getLocation((result) => {
                        result ? resolve(result) : reject(new Error('TG location denied'));
                    });
                });
            });
            onSuccess(loc.latitude, loc.longitude, 'telegram');
            return;
        } catch (e) {
            console.log('[location] Tier 1 failed:', e.message);
        }
    }

    if (!navigator.geolocation) {
        if (onManualFallback) onManualFallback();
        return;
    }

    // TIER 2: Fast coarse location (network/IP, works on desktop, ~1s)
    try {
        status('Getting location…');
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 300000   // accept 5-minute-old cache
            });
        });
        onSuccess(pos.coords.latitude, pos.coords.longitude, 'coarse');
        return;
    } catch (e) {
        console.log('[location] Tier 2 failed:', e.message);
    }

    // TIER 3: High-accuracy GPS (mobile only, takes longer)
    try {
        status('Getting precise location…');
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 0
            });
        });
        onSuccess(pos.coords.latitude, pos.coords.longitude, 'gps');
        return;
    } catch (e) {
        console.log('[location] Tier 3 failed:', e.message);
    }

    // TIER 4: Manual fallback
    if (onManualFallback) onManualFallback();
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
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}
