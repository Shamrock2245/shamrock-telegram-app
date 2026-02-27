/**
 * Shamrock Bail Bonds — My Case Status
 * app.js
 *
 * Flow:
 *   1. Phone + name lookup → GAS telegram_status_lookup
 *   2. Render case dashboard (court dates, payments, docs, summary)
 *      OR "Not found" state
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const STATUS_CONFIG = {
    GAS_ENDPOINT: typeof SHAMROCK_GAS_ENDPOINT !== 'undefined'
        ? SHAMROCK_GAS_ENDPOINT
        : 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec',
    ACTION_LOOKUP: 'telegram_status_lookup'
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state = {
    phone: '',
    name: '',
    caseData: null
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTelegram();
    bindEvents();

    // Pre-fill name from Telegram
    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        if (fullName) {
            document.getElementById('lookupName').value = fullName;
            validateForm();
        }
    }
});

// ═══════════════════════════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════════════════════════

function bindEvents() {
    // Theme
    document.getElementById('themeToggle').addEventListener('click', () => {
        toggleTheme();
        const icon = document.querySelector('.theme-icon');
        const theme = document.documentElement.getAttribute('data-theme');
        icon.textContent = theme === 'light' ? '☀️' : '🌙';
    });

    // Phone formatting
    const phoneInput = document.getElementById('lookupPhone');
    phoneInput.addEventListener('input', debounce((e) => {
        e.target.value = formatPhone(e.target.value);
        validateForm();
    }, 150));
    document.getElementById('lookupName').addEventListener('input', validateForm);
    document.getElementById('btnLookup').addEventListener('click', handleLookup);

    // Refresh button
    document.getElementById('btnRefresh').addEventListener('click', handleLookup);

    // Try again
    document.getElementById('btnTryAgain').addEventListener('click', () => {
        goToStep('stepIdentify');
        if (tg) tg.BackButton.hide();
    });

    // Telegram back button
    if (tg) {
        tg.BackButton.onClick(() => {
            goToStep('stepIdentify');
            tg.BackButton.hide();
            if (tg) tg.HapticFeedback.impactOccurred('light');
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// FORM VALIDATION
// ═══════════════════════════════════════════════════════════════

function validateForm() {
    const phone = document.getElementById('lookupPhone').value;
    const name = document.getElementById('lookupName').value.trim();
    const valid = isValidPhone(phone) && name.length >= 2;
    document.getElementById('btnLookup').disabled = !valid;
}

// ═══════════════════════════════════════════════════════════════
// LOOKUP — fires to GAS and renders real or fallback data
// ═══════════════════════════════════════════════════════════════

async function handleLookup() {
    const phone = document.getElementById('lookupPhone').value;
    const name = document.getElementById('lookupName').value.trim();

    state.phone = phone;
    state.name = name;

    const btn = document.getElementById('btnLookup');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    btn.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (btnLoader) btnLoader.classList.remove('hidden');

    if (tg) tg.HapticFeedback.impactOccurred('medium');

    const payload = {
        action: STATUS_CONFIG.ACTION_LOOKUP,
        phone: phone.replace(/\D/g, ''),
        name: name,
        telegramUserId: tgUser?.id?.toString() || '',
        source: 'telegram_mini_app',
        timestamp: new Date().toISOString()
    };

    let caseData = null;

    // Try real GAS lookup (CORS-enabled doPost returns JSON)
    try {
        const resp = await fetch(STATUS_CONFIG.GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });

        if (resp.ok) {
            const result = await resp.json();
            if (result.success && result.caseData) {
                caseData = result.caseData;
                console.log('✅ Real case data received from GAS');
            } else if (result.success && !result.caseData) {
                // Lookup logged but no case data found — show not-found
                caseData = buildNotFoundData(name, phone);
                console.log('ℹ️ Lookup logged, no case found');
            }
        }
    } catch (err) {
        console.log('GAS lookup error:', err.message);
        // P1-8: Network error — distinguish from "case not found"
        caseData = buildOfflineData(name, phone);
    }

    // Fallback: if GAS didn't return case data, show a "pending lookup" state
    if (!caseData) {
        caseData = buildPendingLookupData(name, phone);
    }

    state.caseData = caseData;
    // Remove skeleton state before rendering
    const dashboardEl = document.getElementById('stepDashboard');
    if (dashboardEl) dashboardEl.classList.remove('skeleton-loading');
    renderDashboard(state.caseData);

    goToStep(caseData._notFound ? 'stepNotFound' : 'stepDashboard');
    if (tg) {
        tg.HapticFeedback.notificationOccurred((caseData._notFound || caseData._offline) ? 'warning' : 'success');
        tg.BackButton.show();
    }

    btn.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoader) btnLoader.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// CASE DATA BUILDERS
// ═══════════════════════════════════════════════════════════════

/**
 * Build a "not found" result when GAS confirms the phone isn't in the system.
 */
function buildNotFoundData(name, phone) {
    return {
        _notFound: true,
        name: name,
        phone: phone,
        status: 'Not Found'
    };
}

/**
 * Build a "pending lookup" card when we can't reach GAS.
 * Shows the user we received their request and staff will follow up.
 */
function buildOfflineData(name, phone) {
    return {
        _offline: true,
        _notFound: false,
        name: name,
        phone: phone,
        status: 'Offline',
        courtDates: null,
        payment: null,
        caseSummary: {
            bondAmount: null,
            charges: '⚠️ Could not reach our servers. Please check your connection and try again.',
            postingDate: '—',
            caseNumber: 'Network Error — Please retry'
        },
        documents: []
    };
}

function buildPendingLookupData(name, phone) {
    return {
        name: name,
        phone: phone,
        status: 'Pending',
        courtDates: null,
        payment: null,
        caseSummary: {
            bondAmount: null,
            charges: 'Your lookup has been submitted to our staff.',
            postingDate: '—',
            caseNumber: 'Pending — We\'ll call you shortly.'
        },
        documents: []
    };
}

// ═══════════════════════════════════════════════════════════════
// RENDER DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard(data) {
    // Account badge
    document.getElementById('accountName').textContent = data.name;
    document.getElementById('accountPhone').textContent = data.phone;

    // Court dates
    if (data.courtDates) {
        document.getElementById('nextCourtDate').textContent = data.courtDates.nextDate || '—';
        document.getElementById('courtroom').textContent = data.courtDates.courtroom || '—';
        document.getElementById('judge').textContent = data.courtDates.judge || '—';
        document.getElementById('courtDatesContent').classList.remove('hidden');
        document.getElementById('noCourtDates').classList.add('hidden');
    } else {
        document.getElementById('courtDatesContent').classList.add('hidden');
        document.getElementById('noCourtDates').classList.remove('hidden');
    }

    // Payment schedule
    if (data.payment) {
        document.getElementById('nextPaymentDate').textContent = data.payment.nextDue || '—';
        document.getElementById('amountDue').textContent = formatCurrency(data.payment.amountDue);
        document.getElementById('remainingBalance').textContent = formatCurrency(data.payment.remainingBalance);
        document.getElementById('lastPayment').textContent = data.payment.lastPayment || '—';
    }

    // Case summary
    if (data.caseSummary) {
        document.getElementById('bondAmount').textContent = formatCurrency(data.caseSummary.bondAmount);
        document.getElementById('charges').textContent = data.caseSummary.charges || '—';
        document.getElementById('postingDate').textContent = data.caseSummary.postingDate || '—';
        document.getElementById('caseNumber').textContent = data.caseSummary.caseNumber || '—';
    }

    // Documents
    const docList = document.getElementById('docList');
    docList.innerHTML = '';

    if (data.documents && data.documents.length > 0) {
        data.documents.forEach(doc => {
            const item = document.createElement('a');
            item.className = 'doc-item';
            item.href = doc.url || '#';
            item.target = '_blank';
            item.rel = 'noopener';
            item.innerHTML = `
                <span class="doc-icon">📄</span>
                <span class="doc-name">${doc.name}</span>
                <span class="doc-arrow">›</span>
            `;
            docList.appendChild(item);
        });
        document.getElementById('docsContent').classList.remove('hidden');
        document.getElementById('noDocs').classList.add('hidden');
    } else {
        document.getElementById('docsContent').classList.add('hidden');
        document.getElementById('noDocs').classList.remove('hidden');
    }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount || 0);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function goToStep(stepId) {
    document.querySelectorAll('.step').forEach(s => {
        s.classList.add('hidden');
        s.classList.remove('active');
    });
    const target = document.getElementById(stepId);
    target.classList.remove('hidden');
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
