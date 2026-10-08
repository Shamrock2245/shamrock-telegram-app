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
// MINI APP API — every GAS action goes through /api/miniapp
// The pages never call the GAS /exec URL. /api/miniapp verifies Telegram initData
// (and, for lookups, the Telegram-verified phone) and adds the GAS key server-side.
// ═══════════════════════════════════════════════════════════════

const SHAMROCK_MINIAPP_API = '/api/miniapp';
const SHAMROCK_PHONE = '(239) 332-2245';
const SHAMROCK_PAYMENT_LINK = 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8';

// POST one action. Sends initData; returns parsed JSON (with success:false on refusal).
async function miniappPost(payload) {
    const resp = await fetch(SHAMROCK_MINIAPP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, payload, { initData: tgInitData }))
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
        const err = new Error((data && data.error) || ('Server error ' + resp.status));
        err.status = resp.status;
        err.data = data;
        throw err;
    }
    return data || { success: true, _opaque: true };
}

// Kept for older callers: same signature as before, but always goes through /api/miniapp.
async function gasPost(_endpoint, payload) {
    return miniappPost(payload);
}

// Telegram-signed phone for lookups. Asks once per session via WebApp.requestContact;
// the server verifies the signature. Never send or trust responseUnsafe.
const CONTACT_CACHE_KEY = 'shamrock-tg-contact';
function getVerifiedContact() {
    try {
        const cached = sessionStorage.getItem(CONTACT_CACHE_KEY);
        if (cached) {
            const authDate = Number(new URLSearchParams(cached).get('auth_date') || 0);
            if (authDate && (Date.now() / 1000 - authDate) < 23 * 3600) return Promise.resolve(cached);
        }
    } catch (e) { }
    return new Promise(function (resolve, reject) {
        if (!tg || typeof tg.requestContact !== 'function') {
            reject(new Error('Please update Telegram, or call us at ' + SHAMROCK_PHONE + '.'));
            return;
        }
        tg.requestContact(function (ok, res) {
            if (ok && res && res.response) {
                try { sessionStorage.setItem(CONTACT_CACHE_KEY, res.response); } catch (e) { }
                resolve(res.response);
            } else {
                reject(new Error('To look up your case, share your Telegram phone number. Or call us at ' + SHAMROCK_PHONE + '.'));
            }
        });
    });
}

// Lookup by the caller's own Telegram-verified phone. A typed phone must match it.
async function miniappLookup(action, phone) {
    const contact = await getVerifiedContact();
    try {
        return await miniappPost({ action: action, phone: phone || '', contact: contact });
    } catch (err) {
        const code = err.data && err.data.error;
        if (err.data && err.data.needContact) {
            try { sessionStorage.removeItem(CONTACT_CACHE_KEY); } catch (e) { }
        }
        const friendly = {
            not_your_phone: 'You can only look up the phone number on your Telegram account.',
            case_number_lookup_not_allowed: 'Look up by your phone number instead of a case number.',
            phone_not_verified: 'Please share your Telegram phone number and try again.',
            contact_user_mismatch: 'Please share your own Telegram phone number and try again.',
            unauthorized: 'Please reopen this page from the Shamrock Telegram bot and try again.',
            rate_limited: 'Too many lookups. Please wait a few minutes and try again.',
            document_lookup_unavailable: 'Document lookup is temporarily unavailable. Please call (239) 332-2245 and we will pull up your packet.'
        }[code];
        if (friendly) {
            const e2 = new Error(friendly);
            e2.status = err.status;
            e2.data = err.data;
            throw e2;
        }
        throw err;
    }
}

// Read a file as base64 for upload. Photos over ~3 MB are shrunk (max 2048 px, JPEG)
// so the request fits the 6 MB serverless body limit.
function prepareUploadBase64(file) {
    const LIMIT = 3 * 1024 * 1024;
    function readRaw(f) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function (e) { resolve(String(e.target.result || '').split(',')[1] || ''); };
            reader.onerror = reject;
            reader.readAsDataURL(f);
        });
    }
    const isImage = /^image\/(jpe?g|png|webp)$/i.test(file.type || '');
    if (!isImage || file.size <= LIMIT || typeof document === 'undefined') {
        return readRaw(file).then(function (b64) { return { base64: b64, mimeType: file.type || 'image/jpeg', fileName: file.name || 'upload.jpg' }; });
    }
    return new Promise(function (resolve) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () {
            const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || '';
            resolve({ base64: b64, mimeType: 'image/jpeg', fileName: (file.name || 'upload').replace(/\.[^.]+$/, '') + '.jpg' });
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            readRaw(file).then(function (b64) { resolve({ base64: b64, mimeType: file.type, fileName: file.name }); });
        };
        img.src = url;
    });
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
