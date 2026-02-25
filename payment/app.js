/**
 * Shamrock Bail Bonds — Payment Mini App
 * app.js
 *
 * 3-step payment flow:
 *   1. Identity lookup (phone + name)
 *   2. Amount selection (presets or custom)
 *   3. Pay via SwipeSimple / Venmo / Zelle
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG (inherits SHAMROCK_GAS_ENDPOINT from shared/brand.js)
// ═══════════════════════════════════════════════════════════════

const PAYMENT_CONFIG = {
    GAS_ENDPOINT: typeof SHAMROCK_GAS_ENDPOINT !== 'undefined'
        ? SHAMROCK_GAS_ENDPOINT
        : 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec',

    SWIPESIMPLE_LINK: typeof SHAMROCK_PAYMENT_LINK !== 'undefined'
        ? SHAMROCK_PAYMENT_LINK
        : 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8',

    ACTION_LOG: 'telegram_payment_log',
    ACTION_LOOKUP: 'telegram_payment_lookup'
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state = {
    phone: '',
    name: '',
    accountFound: false,
    accountData: null,
    paymentType: 'checkin',
    amount: 25,
    referenceId: ''
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTelegram();
    bindEvents();

    // Pre-fill name from Telegram if available
    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        if (fullName) {
            document.getElementById('lookupName').value = fullName;
            validateStep1();
        }
    }
});

// ═══════════════════════════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════════════════════════

function bindEvents() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
        toggleTheme();
        const icon = document.querySelector('.theme-icon');
        const theme = document.documentElement.getAttribute('data-theme');
        icon.textContent = theme === 'light' ? '☀️' : '🌙';
    });

    // Step 1: Phone input formatting + validation
    const phoneInput = document.getElementById('lookupPhone');
    phoneInput.addEventListener('input', (e) => {
        e.target.value = formatPhone(e.target.value);
        validateStep1();
    });

    document.getElementById('lookupName').addEventListener('input', validateStep1);

    // Step 1: Lookup button
    document.getElementById('btnLookup').addEventListener('click', handleLookup);

    // Step 2: Payment type buttons
    document.querySelectorAll('.payment-type').forEach(btn => {
        btn.addEventListener('click', () => selectPaymentType(btn.dataset.type));
    });

    // Step 2: Preset amount buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => selectPresetAmount(btn));
    });

    // Step 2: Custom amount input
    document.getElementById('customAmount')?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
            state.amount = val;
            updateAmountDisplay();
            // Deselect presets
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        }
    });

    // Step 2: Continue button
    document.getElementById('btnContinue').addEventListener('click', goToStep3);

    // Step 3: Pay Now
    document.getElementById('payNowBtn').addEventListener('click', handlePayNow);

    // Step 3: Venmo modal
    document.getElementById('btnVenmo').addEventListener('click', () => {
        document.getElementById('venmoModal').classList.remove('hidden');
        if (tg) tg.HapticFeedback.impactOccurred('light');
    });
    document.getElementById('closeVenmo').addEventListener('click', () => {
        document.getElementById('venmoModal').classList.add('hidden');
    });
    document.querySelector('.modal-backdrop')?.addEventListener('click', () => {
        document.getElementById('venmoModal').classList.add('hidden');
    });

    // Success: New payment
    document.getElementById('btnNewPayment').addEventListener('click', resetFlow);

    // Telegram back button
    if (tg) {
        tg.BackButton.onClick(() => handleBack());
    }
}

// ═══════════════════════════════════════════════════════════════
// STEP 1: IDENTITY LOOKUP
// ═══════════════════════════════════════════════════════════════

function validateStep1() {
    const phone = document.getElementById('lookupPhone').value;
    const name = document.getElementById('lookupName').value.trim();
    const valid = isValidPhone(phone) && name.length >= 2;
    document.getElementById('btnLookup').disabled = !valid;
}

async function handleLookup() {
    const phone = document.getElementById('lookupPhone').value;
    const name = document.getElementById('lookupName').value.trim();

    state.phone = phone;
    state.name = name;

    const btn = document.getElementById('btnLookup');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    btn.disabled = true;
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');

    if (tg) tg.HapticFeedback.impactOccurred('medium');

    try {
        // Try to look up the account in GAS
        await fetch(PAYMENT_CONFIG.GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: PAYMENT_CONFIG.ACTION_LOOKUP,
                phone: phone.replace(/\D/g, ''),
                name: name,
                telegramUserId: tgUser?.id?.toString() || ''
            }),
            mode: 'no-cors'
        });
    } catch (err) {
        console.log('Lookup fetch (no-cors, expected opaque):', err);
    }

    // Since no-cors gives opaque response, we proceed optimistically
    // In the future, this could use a CORS-enabled endpoint for real lookup
    setTimeout(() => {
        // For now, treat every user as valid and proceed
        state.accountFound = true;

        // Show account card on step 2
        document.getElementById('accountName').textContent = name;
        document.getElementById('accountDetail').textContent = formatPhone(phone);
        document.getElementById('accountCard').classList.remove('hidden');

        goToStep('stepAmount');
        if (tg) {
            tg.HapticFeedback.notificationOccurred('success');
            tg.BackButton.show();
        }

        btn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    }, 600);
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: AMOUNT SELECTION
// ═══════════════════════════════════════════════════════════════

function selectPaymentType(type) {
    state.paymentType = type;

    document.querySelectorAll('.payment-type').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });

    if (tg) tg.HapticFeedback.selectionChanged();

    const presets = document.getElementById('presetAmounts');
    const custom = document.getElementById('customAmountWrap');

    if (type === 'checkin') {
        presets.classList.remove('hidden');
        custom.classList.add('hidden');
        // Select first preset
        const firstPreset = document.querySelector('.preset-btn');
        if (firstPreset) selectPresetAmount(firstPreset);
    } else if (type === 'premium') {
        presets.classList.add('hidden');
        custom.classList.remove('hidden');
        state.amount = 0;
        updateAmountDisplay();
    } else {
        presets.classList.add('hidden');
        custom.classList.remove('hidden');
        state.amount = 0;
        updateAmountDisplay();
    }
}

function selectPresetAmount(btn) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.amount = parseFloat(btn.dataset.amount);
    updateAmountDisplay();
    if (tg) tg.HapticFeedback.selectionChanged();
}

function updateAmountDisplay() {
    const formatted = formatCurrency(state.amount);
    document.getElementById('selectedAmount').textContent = formatted;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount || 0);
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: PAYMENT
// ═══════════════════════════════════════════════════════════════

function goToStep3() {
    if (state.amount <= 0) {
        if (tg) tg.HapticFeedback.notificationOccurred('error');
        document.getElementById('customAmount')?.focus();
        return;
    }

    const typeLabels = { checkin: 'Check-In Fee', premium: 'Premium Payment', other: 'Other Payment' };
    const formatted = formatCurrency(state.amount);

    document.getElementById('summaryType').textContent = typeLabels[state.paymentType] || 'Payment';
    document.getElementById('summaryName').textContent = state.name;
    document.getElementById('summaryPhone').textContent = state.phone;
    document.getElementById('summaryTotal').textContent = formatted;
    document.getElementById('payBtnAmount').textContent = formatted;

    // Build SwipeSimple link
    document.getElementById('payNowBtn').href = PAYMENT_CONFIG.SWIPESIMPLE_LINK;

    goToStep('stepPay');
    if (tg) tg.HapticFeedback.impactOccurred('medium');
}

function handlePayNow(e) {
    // Generate reference ID
    state.referenceId = 'PAY-' + Date.now().toString(36).toUpperCase();

    if (tg) tg.HapticFeedback.impactOccurred('heavy');

    // Log the payment attempt to GAS (fire-and-forget)
    logPaymentToGAS('initiated');

    // After a short delay to let the user see SwipeSimple open, show success
    setTimeout(() => {
        document.getElementById('refId').textContent = state.referenceId;
        goToStep('stepSuccess');

        if (tg) {
            tg.HapticFeedback.notificationOccurred('success');
            tg.BackButton.hide();

            // Send data back to bot
            try {
                tg.sendData(JSON.stringify({
                    action: 'payment_completed',
                    referenceId: state.referenceId,
                    amount: state.amount,
                    type: state.paymentType,
                    name: state.name,
                    phone: state.phone
                }));
            } catch (err) {
                console.log('tg.sendData:', err);
            }
        }
    }, 1500);
}

// ═══════════════════════════════════════════════════════════════
// GAS LOGGING
// ═══════════════════════════════════════════════════════════════

function logPaymentToGAS(status) {
    try {
        fetch(PAYMENT_CONFIG.GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: PAYMENT_CONFIG.ACTION_LOG,
                referenceId: state.referenceId,
                name: state.name,
                phone: state.phone.replace(/\D/g, ''),
                amount: state.amount,
                paymentType: state.paymentType,
                status: status,
                telegramUserId: tgUser?.id?.toString() || '',
                telegramUsername: tgUser?.username || '',
                source: 'telegram_mini_app',
                platform: 'telegram',
                timestamp: new Date().toISOString()
            }),
            mode: 'no-cors'
        });
    } catch (err) {
        console.log('Payment log (non-fatal):', err);
    }
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

function handleBack() {
    const steps = ['stepIdentify', 'stepAmount', 'stepPay', 'stepSuccess'];
    const current = steps.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });

    const idx = steps.indexOf(current);
    if (idx > 0) {
        goToStep(steps[idx - 1]);
        if (tg) tg.HapticFeedback.impactOccurred('light');
        if (idx - 1 === 0) tg?.BackButton.hide();
    } else {
        if (tg) tg.close();
    }
}

function resetFlow() {
    state = {
        phone: '',
        name: '',
        accountFound: false,
        accountData: null,
        paymentType: 'checkin',
        amount: 25,
        referenceId: ''
    };

    // Reset form
    document.getElementById('lookupPhone').value = '';
    document.getElementById('lookupName').value = '';
    document.getElementById('notFoundMsg').classList.add('hidden');
    document.getElementById('accountCard').classList.add('hidden');
    document.getElementById('customAmount') && (document.getElementById('customAmount').value = '');
    document.getElementById('btnLookup').disabled = true;

    // Reset presets
    document.querySelectorAll('.preset-btn').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
    });
    selectPaymentType('checkin');
    updateAmountDisplay();

    goToStep('stepIdentify');
    if (tg) {
        tg.BackButton.hide();
        tg.HapticFeedback.impactOccurred('light');
    }

    // Re-fill Telegram name if available
    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        if (fullName) document.getElementById('lookupName').value = fullName;
    }
}
