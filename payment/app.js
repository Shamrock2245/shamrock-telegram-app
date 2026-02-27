/**
 * Shamrock Bail Bonds — Check-In & Payments
 * app.js
 *
 * Dual-purpose flow:
 *   1. Identity lookup (phone + name)
 *   2. Purpose selector (Check-In Only or Make a Payment)
 *   3A. Check-In: Selfie + GPS → submit
 *   3B. Payment: Preset amounts ($50/$100/$200/$250) or custom → SwipeSimple / CashApp
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const PAYMENT_CONFIG = {
    GAS_ENDPOINT: typeof SHAMROCK_GAS_ENDPOINT !== 'undefined'
        ? SHAMROCK_GAS_ENDPOINT
        : 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec',

    SWIPESIMPLE_LINK: typeof SHAMROCK_PAYMENT_LINK !== 'undefined'
        ? SHAMROCK_PAYMENT_LINK
        : 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8',

    CASHAPP_TAG: '$Shamrock2245',
    ACTION_PAYMENT_LOG: 'telegram_payment_log',
    ACTION_CHECKIN_LOG: 'telegram_checkin_log',
    ACTION_LOOKUP: 'telegram_payment_lookup'
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state = {
    phone: '',
    name: '',
    accountFound: false,
    flowType: null,       // 'checkin' or 'payment'
    // Check-in
    selfieFile: null,
    selfieBase64: null,
    latitude: null,
    longitude: null,
    // Payment
    amount: 50,
    referenceId: ''
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Restore name/phone from previous session
    const savedSession = loadFormSession('payment');
    if (savedSession) {
        try {
            if (savedSession.name) document.getElementById('lookupName').value = savedSession.name;
            if (savedSession.phone) document.getElementById('lookupPhone').value = savedSession.phone;
        } catch (e) { /* silent */ }
    }
    initTheme();
    initTelegram();
    bindEvents();

    // Pre-fill name from Telegram
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

    // Step 1: Phone formatting + validation
    const phoneInput = document.getElementById('lookupPhone');
    phoneInput.addEventListener('input', debounce((e) => {
        e.target.value = formatPhone(e.target.value);
        validateStep1();
    }, 150));
    document.getElementById('lookupName').addEventListener('input', validateStep1);
    document.getElementById('btnLookup').addEventListener('click', handleLookup);

    // Step 2: Purpose cards
    document.getElementById('btnPurposeCheckin').addEventListener('click', () => selectPurpose('checkin'));
    document.getElementById('btnPurposePayment').addEventListener('click', () => selectPurpose('payment'));

    // Step 3A: Check-in
    document.querySelector('.checkin-item:first-child')?.addEventListener('click', () => {
        document.getElementById('selfieInput').click();
    });
    document.getElementById('selfieInput').addEventListener('change', handleSelfieCapture);
    document.getElementById('locationItem').addEventListener('click', handleLocationCapture);
    document.getElementById('btnSubmitCheckin').addEventListener('click', submitCheckin);

    // Step 3B: Preset amounts
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => selectPresetAmount(btn));
    });
    document.getElementById('customAmount')?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
            state.amount = val;
            updateAmountDisplay();
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        }
    });
    document.getElementById('btnContinue').addEventListener('click', goToPayStep);

    // Step 4: Pay Now
    document.getElementById('payNowBtn').addEventListener('click', handlePayNow);

    // CashApp modal
    document.getElementById('btnCashApp').addEventListener('click', () => {
        document.getElementById('cashAppModal').classList.remove('hidden');
        if (tg) tg.HapticFeedback.impactOccurred('light');
    });
    document.getElementById('closeCashApp').addEventListener('click', () => {
        document.getElementById('cashAppModal').classList.add('hidden');
    });
    document.querySelector('.modal-backdrop')?.addEventListener('click', () => {
        document.getElementById('cashAppModal').classList.add('hidden');
    });

    // Success: Start over
    document.getElementById('btnStartOver').addEventListener('click', resetFlow);

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

    // Try real GAS lookup — if it fails, proceed optimistically
    try {
        const lookupResult = await gasPost(PAYMENT_CONFIG.GAS_ENDPOINT, {
            action: PAYMENT_CONFIG.ACTION_LOOKUP,
            phone: phone.replace(/\D/g, ''),
            name: name,
            telegramUserId: tgUser?.id?.toString() || ''
        });
        if (lookupResult && lookupResult.caseData) {
            state.caseData = lookupResult.caseData;
        }
    } catch (err) {
        console.log('Lookup error (proceeding optimistically):', err.message);
    }

    setTimeout(() => {
        state.accountFound = true;
        // Save name/phone to session
        saveFormSession('payment', { name: state.name, phone: state.phone });

        document.getElementById('accountName').textContent = name;
        document.getElementById('accountDetail').textContent = formatPhone(phone);
        document.getElementById('accountCard').classList.remove('hidden');

        goToStep('stepPurpose');
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
// STEP 2: PURPOSE SELECTOR
// ═══════════════════════════════════════════════════════════════

function selectPurpose(type) {
    state.flowType = type;
    if (tg) tg.HapticFeedback.impactOccurred('medium');

    if (type === 'checkin') {
        goToStep('stepCheckin');
    } else {
        goToStep('stepAmount');
    }
}

// ═══════════════════════════════════════════════════════════════
// STEP 3A: CHECK-IN (Selfie + GPS)
// ═══════════════════════════════════════════════════════════════

function handleSelfieCapture(e) {
    const file = e.target.files[0];
    if (!file) return;

    // P1-8: Confirm selfie before accepting
    if (tg) {
        tg.showConfirm('Use this photo for your check-in?', (confirmed) => {
            if (!confirmed) {
                // Reset selfie state
                state.selfieFile = null;
                state.selfieBase64 = null;
                document.getElementById('selfiePreview').classList.add('hidden');
                document.getElementById('selfieStatus').textContent = 'Tap to take photo';
                document.getElementById('selfieInput').value = '';
                return;
            }
            acceptSelfie(file);
        });
        return;
    }
    acceptSelfie(file);
}
function acceptSelfie(file) {
    state.selfieFile = file;

    // Read as base64 for preview and upload
    const reader = new FileReader();
    reader.onload = (ev) => {
        state.selfieBase64 = ev.target.result;
        const img = document.getElementById('selfieImg');
        img.src = ev.target.result;
        document.getElementById('selfiePreview').classList.remove('hidden');
        document.getElementById('selfieStatus').textContent = 'Photo captured ✓';
        document.getElementById('selfieStatus').classList.add('done');
        validateCheckin();
    };
    reader.readAsDataURL(file);

    if (tg) tg.HapticFeedback.notificationOccurred('success');
}

function handleLocationCapture() {
    const status = document.getElementById('locationStatus');
    captureLocationTiered({
        onSuccess: (lat, lng, source) => {
            state.latitude = lat;
            state.longitude = lng;
            status.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            status.classList.add('done');
            document.getElementById('locationBadge').classList.remove('hidden');
            validateCheckin();
            if (tg) tg.HapticFeedback.notificationOccurred('success');
            console.log('[location] Captured via', source);
        },
        onManualFallback: () => {
            status.textContent = 'Location unavailable — proceeding without GPS';
            // Allow checkin without location if selfie is present
            if (state.selfieFile) {
                document.getElementById('btnSubmitCheckin').disabled = false;
            }
        },
        onStatusUpdate: (msg) => { status.textContent = msg; }
    });
}

function validateCheckin() {
    const hasSelfie = !!state.selfieFile;
    const hasLocation = state.latitude !== null;
    document.getElementById('btnSubmitCheckin').disabled = !(hasSelfie && hasLocation);
}

async function submitCheckin() {
    const btn = document.getElementById('btnSubmitCheckin');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    btn.disabled = true;
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');

    if (tg) tg.HapticFeedback.impactOccurred('heavy');

    state.referenceId = 'CHK-' + Date.now().toString(36).toUpperCase();

    // Log check-in to GAS
    try {
        await gasPost(PAYMENT_CONFIG.GAS_ENDPOINT, {
            action: PAYMENT_CONFIG.ACTION_CHECKIN_LOG,
            referenceId: state.referenceId,
            name: state.name,
            phone: state.phone.replace(/\D/g, ''),
            hasSelfie: !!state.selfieBase64,
            latitude: state.latitude,
            longitude: state.longitude,
            telegramUserId: tgUser?.id?.toString() || '',
            telegramUsername: tgUser?.username || '',
            source: 'telegram_mini_app',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.log('Check-in log (non-fatal):', err.message);
    }
    // Upload selfie BEFORE tg.sendData (sendData closes the WebView)
    if (state.selfieBase64) {
        try {
            if (btnText) btnText.textContent = 'Uploading photo...';
            await gasPost(PAYMENT_CONFIG.GAS_ENDPOINT, {
                action: 'telegram_mini_app_upload',
                telegramUserId: tgUser?.id?.toString() || '',
                docType: 'checkin_selfie',
                fileName: `checkin_${state.referenceId}.jpg`,
                mimeType: state.selfieFile?.type || 'image/jpeg',
                base64Data: state.selfieBase64.split(',')[1]
            });
        } catch (err) {
            console.log('Selfie upload (non-fatal):', err.message);
        }
    }
    // Clear session after successful checkin
    clearFormSession('payment');
    // Show success then send data to bot
    document.getElementById('successTitle').textContent = 'Check-In Complete!';
    document.getElementById('successMsg').textContent =
        'Thank you, ' + state.name + '. Your check-in has been recorded.';
    document.getElementById('refId').textContent = state.referenceId;
    goToStep('stepSuccess');
    if (tg) {
        tg.HapticFeedback.notificationOccurred('success');
        tg.BackButton.hide();
        try {
            tg.sendData(JSON.stringify({
                action: 'checkin_completed',
                referenceId: state.referenceId,
                name: state.name,
                phone: state.phone,
                latitude: state.latitude,
                longitude: state.longitude
            }));
        } catch (err) {
            console.log('tg.sendData:', err);
        }
    }
    btn.disabled = false;
    if (btnText) btnText.textContent = 'Submit Check-In';
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// STEP 3B: PAYMENT AMOUNT
// ═══════════════════════════════════════════════════════════════

function selectPresetAmount(btn) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.amount = parseFloat(btn.dataset.amount);
    updateAmountDisplay();
    // Clear custom input when preset used
    const customInput = document.getElementById('customAmount');
    if (customInput) customInput.value = '';
    if (tg) tg.HapticFeedback.selectionChanged();
}

function updateAmountDisplay() {
    document.getElementById('selectedAmount').textContent = formatCurrency(state.amount);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount || 0);
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: PAYMENT
// ═══════════════════════════════════════════════════════════════

function goToPayStep() {
    if (state.amount <= 0) {
        if (tg) tg.HapticFeedback.notificationOccurred('error');
        document.getElementById('customAmount')?.focus();
        return;
    }

    const formatted = formatCurrency(state.amount);
    document.getElementById('summaryName').textContent = state.name;
    document.getElementById('summaryPhone').textContent = state.phone;
    document.getElementById('summaryTotal').textContent = formatted;
    document.getElementById('payBtnAmount').textContent = formatted;

    document.getElementById('payNowBtn').href = PAYMENT_CONFIG.SWIPESIMPLE_LINK;

    goToStep('stepPay');
    if (tg) tg.HapticFeedback.impactOccurred('medium');
}

function handlePayNow(e) {
    state.referenceId = 'PAY-' + Date.now().toString(36).toUpperCase();

    if (tg) tg.HapticFeedback.impactOccurred('heavy');

    // Log payment to GAS
    logPaymentToGAS('initiated');

    setTimeout(() => {
        document.getElementById('successTitle').textContent = 'Payment Submitted!';
        document.getElementById('successMsg').textContent =
            'Thank you. If you completed the payment on the SwipeSimple page, you\'ll receive a receipt shortly.';
        document.getElementById('refId').textContent = state.referenceId;
        goToStep('stepSuccess');

        if (tg) {
            tg.HapticFeedback.notificationOccurred('success');
            tg.BackButton.hide();
            try {
                tg.sendData(JSON.stringify({
                    action: 'payment_completed',
                    referenceId: state.referenceId,
                    amount: state.amount,
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
    // Fire-and-forget — non-fatal
    gasPost(PAYMENT_CONFIG.GAS_ENDPOINT, {
        action: PAYMENT_CONFIG.ACTION_PAYMENT_LOG,
        referenceId: state.referenceId,
        name: state.name,
        phone: state.phone.replace(/\D/g, ''),
        amount: state.amount,
        paymentType: 'payment_plan',
        status: status,
        telegramUserId: tgUser?.id?.toString() || '',
        telegramUsername: tgUser?.username || '',
        source: 'telegram_mini_app',
        platform: 'telegram',
        timestamp: new Date().toISOString()
    }).catch(err => console.log('Payment log (non-fatal):', err.message));
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

const STEP_ORDER = ['stepIdentify', 'stepPurpose', 'stepCheckin', 'stepAmount', 'stepPay', 'stepSuccess'];

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
    const current = STEP_ORDER.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });

    if (!current) return;

    // Custom back logic based on flow
    if (current === 'stepCheckin' || current === 'stepAmount') {
        goToStep('stepPurpose');
    } else if (current === 'stepPay') {
        goToStep('stepAmount');
    } else if (current === 'stepPurpose') {
        goToStep('stepIdentify');
        if (tg) tg.BackButton.hide();
    } else {
        if (tg) tg.close();
        return;
    }

    if (tg) tg.HapticFeedback.impactOccurred('light');
}

function resetFlow() {
    state = {
        phone: '',
        name: '',
        accountFound: false,
        flowType: null,
        selfieFile: null,
        selfieBase64: null,
        latitude: null,
        longitude: null,
        amount: 50,
        referenceId: ''
    };

    // Reset forms
    document.getElementById('lookupPhone').value = '';
    document.getElementById('lookupName').value = '';
    document.getElementById('notFoundMsg').classList.add('hidden');
    document.getElementById('accountCard').classList.add('hidden');
    const customInput = document.getElementById('customAmount');
    if (customInput) customInput.value = '';
    document.getElementById('btnLookup').disabled = true;
    document.getElementById('btnSubmitCheckin').disabled = true;

    // Reset selfie & location
    document.getElementById('selfiePreview').classList.add('hidden');
    document.getElementById('selfieStatus').textContent = 'Tap to take photo';
    document.getElementById('selfieStatus').classList.remove('done');
    document.getElementById('locationStatus').textContent = 'Tap to share location';
    document.getElementById('locationStatus').classList.remove('done');
    document.getElementById('locationBadge').classList.add('hidden');
    document.getElementById('selfieInput').value = '';

    // Reset presets
    document.querySelectorAll('.preset-btn').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
    });
    updateAmountDisplay();

    goToStep('stepIdentify');
    if (tg) {
        tg.BackButton.hide();
        tg.HapticFeedback.impactOccurred('light');
    }

    // Re-fill Telegram name
    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        if (fullName) document.getElementById('lookupName').value = fullName;
    }
}
