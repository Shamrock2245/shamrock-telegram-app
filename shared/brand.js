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
