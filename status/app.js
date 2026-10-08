/**
 * Shamrock Bail Bonds — My Case Status
 * app.js
 *
 * Flow:
 *   1. Phone + name lookup → GAS telegram_status_lookup
 *   2. Render a timeline of dated fields the lookup actually returns,
 *      then the case dashboard (court dates, payments, summary)
 *      OR "Not found" state
 *
 * Timeline stages map 1:1 to caseData fields from the GAS status lookup.
 * A stage is omitted when its field is missing or null. Documents are not
 * a stage: the lookup returns documents: [] and telegram_document_lookup
 * answers document_lookup_unavailable.
 *   caseSummary.postingDate → Bond posted
 *   payment.lastPayment     → Last payment
 *   courtDates.nextDate     → Next court date
 *   payment.nextDue         → Payment due
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const STATUS_CONFIG = {
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

let lookupInFlight = false;

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
    if (lookupInFlight) return;

    const phone = document.getElementById('lookupPhone').value;
    const name = document.getElementById('lookupName').value.trim();

    state.phone = phone;
    state.name = name;

    const btn = document.getElementById('btnLookup');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');
    const refresh = document.getElementById('btnRefresh');

    lookupInFlight = true;
    btn.disabled = true;
    if (refresh) refresh.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (btnLoader) btnLoader.classList.remove('hidden');

    if (tg) tg.HapticFeedback.impactOccurred('medium');

    // Existing .skeleton-loading shimmer (shared/theme.css) while the lookup runs.
    showStatusSkeleton();

    let caseData = null;

    // Lookup through /api/miniapp. It runs only on the caller's Telegram-verified phone
    // (Telegram.WebApp.requestContact, signature checked server-side).
    try {
        const result = await miniappLookup(STATUS_CONFIG.ACTION_LOOKUP, phone.replace(/\D/g, ''));
        if (result && result.success && result.caseData) {
            caseData = result.caseData;
        } else if (result && result.success && !result.caseData) {
            caseData = buildNotFoundData(name, phone);
        }
    } catch (err) {
        console.log('Lookup error:', err.message);
        if (err.status || !(err instanceof TypeError)) {
            // Refused (phone not verified / not yours) or contact not shared: say why, stay put.
            if (tg) tg.showAlert(err.message); else alert(err.message);
            hideStatusSkeleton();
            goToStep('stepIdentify');
            if (tg) tg.BackButton.hide();
            lookupInFlight = false;
            btn.disabled = false;
            if (refresh) refresh.disabled = false;
            if (btnText) btnText.classList.remove('hidden');
            if (btnLoader) btnLoader.classList.add('hidden');
            return;
        }
        // Network error — distinguish from "case not found"
        caseData = buildOfflineData(name, phone);
    }

    // Fallback: if GAS didn't return case data, show a "pending lookup" state
    if (!caseData) {
        caseData = buildPendingLookupData(name, phone);
    }

    state.caseData = caseData;
    hideStatusSkeleton();
    renderDashboard(state.caseData);

    goToStep(caseData._notFound ? 'stepNotFound' : 'stepDashboard');
    if (tg) {
        tg.HapticFeedback.notificationOccurred((caseData._notFound || caseData._offline) ? 'warning' : 'success');
        tg.BackButton.show();
    }

    lookupInFlight = false;
    btn.disabled = false;
    if (refresh) refresh.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoader) btnLoader.classList.add('hidden');
}

function showStatusSkeleton() {
    const dashboardEl = document.getElementById('stepDashboard');
    if (dashboardEl) dashboardEl.classList.add('skeleton-loading');
    const status = document.getElementById('timelineStatus');
    if (status) status.textContent = 'Loading your case timeline';
    const list = document.getElementById('statusTimeline');
    const empty = document.getElementById('timelineEmpty');
    if (empty) empty.classList.add('hidden');
    if (list) {
        list.hidden = false;
        list.textContent = '';
        for (let i = 0; i < 3; i++) {
            const item = document.createElement('li');
            item.className = 'timeline-item status-card';
            item.setAttribute('aria-hidden', 'true');
            const marker = document.createElement('span');
            marker.className = 'timeline-marker';
            const copy = document.createElement('div');
            copy.className = 'timeline-copy info-row';
            const label = document.createElement('span');
            label.className = 'timeline-label';
            label.textContent = 'Stage';
            const when = document.createElement('span');
            when.className = 'timeline-when';
            when.textContent = 'Date';
            copy.append(label, when);
            item.append(marker, copy);
            list.appendChild(item);
        }
    }
    goToStep('stepDashboard');
}

function hideStatusSkeleton() {
    const dashboardEl = document.getElementById('stepDashboard');
    if (dashboardEl) dashboardEl.classList.remove('skeleton-loading');
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
// TIMELINE — only dated fields the status lookup returns
// ═══════════════════════════════════════════════════════════════

const TIMELINE_STATE_LABEL = {
    done: 'Completed',
    today: 'Today',
    upcoming: 'Upcoming',
    recorded: 'On file'
};

function presentField(value) {
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    const text = String(value).trim();
    if (!text) return false;
    const lower = text.toLowerCase();
    return lower !== '—' && lower !== '-' && lower !== 'null' && lower !== 'undefined' && lower !== 'n/a';
}

function timelineTime(value) {
    if (!presentField(value) || typeof value === 'number') return null;
    const raw = String(value).trim();
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;

    const match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (!match) return null;
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    let hour = match[4] != null ? Number(match[4]) : 0;
    const minute = match[5] != null ? Number(match[5]) : 0;
    const ampm = (match[7] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const date = new Date(year, Number(match[1]) - 1, Number(match[2]), hour, minute);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function timelineState(time, now) {
    if (time == null) return 'recorded';
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (time < startMs) return 'done';
    if (time < startMs + day) return 'today';
    return 'upcoming';
}

function timelineEmptyMessage(data) {
    if (data && data._offline) {
        return 'We couldn\'t load your case timeline. Check your connection and tap Refresh.';
    }
    if (data && data.status === 'Pending') {
        return 'Your lookup is in. A bond posting date, last payment, next court date, or payment due date will show here when your case record includes it.';
    }
    return 'No dated steps are on file yet. This timeline only shows a bond posting date, last payment, next court date, or payment due date when your case record includes them.';
}

/**
 * Stages backed by telegram_status_lookup caseData. Sibling fields (courtroom,
 * judge, amount due, bond amount) are notes on a stage, never stages of their own.
 * @param {object} data
 * @param {number} [now]
 * @returns {Array<{id:string,field:string,label:string,detail:string,note:string,state:string,stateLabel:string,time:number|null,order:number}>}
 */
function buildStatusTimeline(data, now) {
    if (!data || data._notFound) return [];
    const clock = typeof now === 'number' ? now : Date.now();
    const summary = data.caseSummary && typeof data.caseSummary === 'object' ? data.caseSummary : {};
    const court = data.courtDates && typeof data.courtDates === 'object' ? data.courtDates : {};
    const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
    const stages = [];

    if (presentField(summary.postingDate)) {
        const note = presentField(summary.bondAmount) ? 'Bond amount ' + formatCurrency(summary.bondAmount) : '';
        stages.push(makeTimelineStage('bond-posted', 'caseSummary.postingDate', 'Bond posted', summary.postingDate, note, 0, clock));
    }
    if (presentField(payment.lastPayment)) {
        stages.push(makeTimelineStage('last-payment', 'payment.lastPayment', 'Last payment', payment.lastPayment, '', 1, clock));
    }
    if (presentField(court.nextDate)) {
        const bits = [];
        if (presentField(court.courtroom)) bits.push(String(court.courtroom).trim());
        if (presentField(court.judge)) bits.push(String(court.judge).trim());
        stages.push(makeTimelineStage('next-court', 'courtDates.nextDate', 'Next court date', court.nextDate, bits.join(' · '), 2, clock));
    }
    if (presentField(payment.nextDue)) {
        const note = presentField(payment.amountDue) ? 'Amount due ' + formatCurrency(payment.amountDue) : '';
        stages.push(makeTimelineStage('payment-due', 'payment.nextDue', 'Payment due', payment.nextDue, note, 3, clock));
    }

    stages.sort((a, b) => {
        if (a.time != null && b.time != null && a.time !== b.time) return a.time - b.time;
        return a.order - b.order;
    });
    return stages;
}

function makeTimelineStage(id, field, label, detail, note, order, now) {
    const time = timelineTime(detail);
    const state = timelineState(time, now);
    return {
        id: id,
        field: field,
        label: label,
        detail: String(detail).trim(),
        note: note || '',
        state: state,
        stateLabel: TIMELINE_STATE_LABEL[state],
        time: time,
        order: order
    };
}

function renderTimeline(data) {
    const list = document.getElementById('statusTimeline');
    const empty = document.getElementById('timelineEmpty');
    const status = document.getElementById('timelineStatus');
    if (!list || !empty) return;

    const stages = buildStatusTimeline(data);
    list.textContent = '';

    if (!stages.length) {
        list.hidden = true;
        empty.textContent = '';
        const message = document.createElement('p');
        message.textContent = timelineEmptyMessage(data);
        empty.appendChild(message);
        empty.classList.remove('hidden');
        if (status) status.textContent = message.textContent;
        return;
    }

    empty.classList.add('hidden');
    list.hidden = false;
    stages.forEach((stage) => {
        const item = document.createElement('li');
        item.className = 'timeline-item timeline-' + stage.state;
        item.dataset.field = stage.field;

        const marker = document.createElement('span');
        marker.className = 'timeline-marker';
        marker.setAttribute('aria-hidden', 'true');

        const copy = document.createElement('div');
        copy.className = 'timeline-copy';

        const head = document.createElement('div');
        head.className = 'timeline-head';

        const label = document.createElement('span');
        label.className = 'timeline-label';
        label.textContent = stage.label;

        const state = document.createElement('span');
        state.className = 'timeline-state';
        state.textContent = stage.stateLabel;

        const when = document.createElement('span');
        when.className = 'timeline-when';
        when.textContent = stage.detail;

        head.append(label, state);
        copy.append(head, when);
        if (stage.note) {
            const note = document.createElement('span');
            note.className = 'timeline-note';
            note.textContent = stage.note;
            copy.append(note);
        }
        item.append(marker, copy);
        list.appendChild(item);
    });
    if (status) status.textContent = 'Case timeline updated. ' + stages.map((stage) => stage.label + ' ' + stage.detail).join('. ');
}

// ═══════════════════════════════════════════════════════════════
// RENDER DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard(data) {
    // Account badge
    document.getElementById('accountName').textContent = data.name || '';
    document.getElementById('accountPhone').textContent = data.phone || '';
    const statusEl = document.getElementById('accountStatus');
    if (statusEl) {
        const status = presentField(data.status) ? String(data.status).trim() : 'Active';
        statusEl.textContent = status;
        statusEl.classList.toggle('active', /^active$/i.test(status));
        statusEl.classList.toggle('warn', /offline|pending/i.test(status));
    }

    renderTimeline(data);

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

    // Payment schedule — hide the rows when the lookup returned no payment object.
    // A missing amount stays an em dash instead of $0.00.
    if (data.payment) {
        document.getElementById('paymentContent').classList.remove('hidden');
        document.getElementById('noPayment').classList.add('hidden');
        document.getElementById('nextPaymentDate').textContent = data.payment.nextDue || '—';
        document.getElementById('amountDue').textContent = formatCurrency(data.payment.amountDue);
        document.getElementById('remainingBalance').textContent = formatCurrency(data.payment.remainingBalance);
        document.getElementById('lastPayment').textContent = data.payment.lastPayment || '—';
    } else {
        document.getElementById('paymentContent').classList.add('hidden');
        document.getElementById('noPayment').classList.remove('hidden');
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
            const icon = document.createElement('span');
            icon.className = 'doc-icon';
            icon.textContent = '📄';
            const name = document.createElement('span');
            name.className = 'doc-name';
            name.textContent = doc.name || 'Document';
            const arrow = document.createElement('span');
            arrow.className = 'doc-arrow';
            arrow.textContent = '›';
            item.append(icon, name, arrow);
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
    if (typeof amount === 'string') {
        const trimmed = amount.trim().replace(/[$,]/g, '');
        if (!presentField(amount)) return '—';
        amount = Number(trimmed);
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
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
