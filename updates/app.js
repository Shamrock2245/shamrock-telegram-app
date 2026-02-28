/**
 * Shamrock Bail Bonds — Update My Info
 * app.js
 *
 * Flow:
 *   1. Identity (phone + name) — OR skip to anonymous tip
 *   2. Choose update type
 *   3. Dynamic form based on type
 *   4. Confirmation + reference ID
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const UPDATE_CONFIG = {
    GAS_ENDPOINT: typeof SHAMROCK_GAS_ENDPOINT !== 'undefined'
        ? SHAMROCK_GAS_ENDPOINT
        : 'https://script.google.com/macros/s/AKfycby5EM_U4d1GRHf_Or64RPGlOFUuOFld4m5ap9DghRm5njoUCTzSmEVmzmwmak9sR6fSFQ/exec',
    ACTION: 'telegram_client_update'
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state = {
    phone: '',
    name: '',
    updateType: null,   // 'contact', 'address', 'extension', 'circumstances', 'anonymous_tip'
    isAnonymous: false,
    referenceId: ''
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
            validateIdentity();
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

    // Step 1: Identity
    const phoneInput = document.getElementById('lookupPhone');
    phoneInput.addEventListener('input', debounce((e) => {
        e.target.value = formatPhone(e.target.value);
        validateIdentity();
    });
    document.getElementById('lookupName').addEventListener('input', validateIdentity);
    document.getElementById('btnContinueIdentity').addEventListener('click', handleIdentityContinue);

    // Anonymous tip shortcut
    document.getElementById('btnAnonymous').addEventListener('click', () => {
        state.isAnonymous = true;
        state.updateType = 'anonymous_tip';
        goToStep('stepTip');
        if (tg) {
            tg.HapticFeedback.impactOccurred('medium');
            tg.BackButton.show();
        }
    });

    // Step 2: Type cards
    document.querySelectorAll('.type-card').forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;
            selectUpdateType(type);
        });
    });

    // Format new phone input too
    const newPhoneInput = document.getElementById('newPhone');
    if (newPhoneInput) {
        newPhoneInput.addEventListener('input', (e) => {
            e.target.value = formatPhone(e.target.value);
        });
    }

    // Submit buttons
    document.getElementById('btnSubmitContact').addEventListener('click', () => submitUpdate('contact'));
    document.getElementById('btnSubmitAddress').addEventListener('click', () => submitUpdate('address'));
    document.getElementById('btnSubmitExtension').addEventListener('click', () => submitUpdate('extension'));
    document.getElementById('btnSubmitCircumstances').addEventListener('click', () => submitUpdate('circumstances'));
    document.getElementById('btnSubmitTip').addEventListener('click', () => submitUpdate('anonymous_tip'));

    // Done
    document.getElementById('btnDone').addEventListener('click', () => {
        if (tg) {
            tg.close();
        } else {
            resetFlow();
        }
    });

    // Telegram back
    if (tg) {
        tg.BackButton.onClick(() => handleBack());
    }
}

// ═══════════════════════════════════════════════════════════════
// STEP 1: IDENTITY
// ═══════════════════════════════════════════════════════════════

function validateIdentity() {
    const phone = document.getElementById('lookupPhone').value;
    const name = document.getElementById('lookupName').value.trim();
    const valid = isValidPhone(phone) && name.length >= 2;
    document.getElementById('btnContinueIdentity').disabled = !valid;
}

function handleIdentityContinue() {
    state.phone = document.getElementById('lookupPhone').value;
    state.name = document.getElementById('lookupName').value.trim();
    state.isAnonymous = false;

    // Show account badge
    document.getElementById('accountName').textContent = state.name;
    document.getElementById('accountPhone').textContent = state.phone;

    goToStep('stepType');
    if (tg) {
        tg.HapticFeedback.impactOccurred('medium');
        tg.BackButton.show();
    }
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: SELECT TYPE
// ═══════════════════════════════════════════════════════════════

const TYPE_STEP_MAP = {
    contact: 'stepContact',
    address: 'stepAddress',
    extension: 'stepExtension',
    circumstances: 'stepCircumstances'
};

function selectUpdateType(type) {
    state.updateType = type;
    const stepId = TYPE_STEP_MAP[type];
    if (stepId) {
        goToStep(stepId);
        if (tg) tg.HapticFeedback.impactOccurred('medium');
    }
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT UPDATE
// ═══════════════════════════════════════════════════════════════

async function submitUpdate(type) {
    // Find the button for this type
    const btnMap = {
        contact: 'btnSubmitContact',
        address: 'btnSubmitAddress',
        extension: 'btnSubmitExtension',
        circumstances: 'btnSubmitCircumstances',
        anonymous_tip: 'btnSubmitTip'
    };

    const btn = document.getElementById(btnMap[type]);
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    btn.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (btnLoader) btnLoader.classList.remove('hidden');

    if (tg) tg.HapticFeedback.impactOccurred('heavy');

    // Generate reference
    const prefix = type === 'anonymous_tip' ? 'TIP' : 'UPD';
    state.referenceId = prefix + '-' + Date.now().toString(36).toUpperCase();

    // Collect form data based on type
    const formData = collectFormData(type);

    // Send to GAS — use text/plain to avoid CORS preflight
    try {
        await gasPost(UPDATE_CONFIG.GAS_ENDPOINT, {
            action: UPDATE_CONFIG.ACTION,
            referenceId: state.referenceId,
            updateType: type,
            isAnonymous: state.isAnonymous,
            name: state.isAnonymous ? 'ANONYMOUS' : state.name,
            phone: state.isAnonymous ? '' : state.phone.replace(/\D/g, ''),
            formData: formData,
            telegramUserId: state.isAnonymous ? '' : (tgUser?.id?.toString() || ''),
            telegramUsername: state.isAnonymous ? '' : (tgUser?.username || ''),
            source: 'telegram_mini_app',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.log('Update submission (non-fatal):', err.message);
    }

    // Show success
    setTimeout(() => {
        if (type === 'anonymous_tip') {
            document.getElementById('successTitle').textContent = 'Tip Received';
            document.getElementById('successMsg').textContent =
                'Thank you. Your anonymous tip has been securely submitted. Our team will investigate.';
        } else if (type === 'extension') {
            document.getElementById('successTitle').textContent = 'Extension Requested';
            document.getElementById('successMsg').textContent =
                'Your payment extension request has been submitted. Our team will review and contact you.';
        } else {
            document.getElementById('successTitle').textContent = 'Update Submitted!';
            document.getElementById('successMsg').textContent =
                'Thank you, ' + state.name + '. Your update has been received and our team will review it.';
        }

        document.getElementById('refId').textContent = state.referenceId;
        goToStep('stepSuccess');

        if (tg) {
            tg.HapticFeedback.notificationOccurred('success');
            tg.BackButton.hide();
            try {
                tg.sendData(JSON.stringify({
                    action: 'client_update',
                    referenceId: state.referenceId,
                    updateType: type,
                    isAnonymous: state.isAnonymous
                }));
            } catch (err) {
                console.log('tg.sendData:', err);
            }
        }

        btn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (btnLoader) btnLoader.classList.add('hidden');
    }, 800);
}

// ═══════════════════════════════════════════════════════════════
// COLLECT FORM DATA
// ═══════════════════════════════════════════════════════════════

function collectFormData(type) {
    switch (type) {
        case 'contact':
            return {
                newPhone: document.getElementById('newPhone')?.value || '',
                newEmail: document.getElementById('newEmail')?.value || '',
                notes: document.getElementById('contactNotes')?.value || ''
            };

        case 'address':
            return {
                address: document.getElementById('newAddress')?.value || '',
                city: document.getElementById('newCity')?.value || '',
                state: document.getElementById('newState')?.value || '',
                zip: document.getElementById('newZip')?.value || '',
                notes: document.getElementById('addressNotes')?.value || ''
            };

        case 'extension':
            return {
                requestedDate: document.getElementById('requestedDate')?.value || '',
                reason: document.getElementById('extensionReason')?.value || ''
            };

        case 'circumstances':
            return {
                details: document.getElementById('circumstancesText')?.value || ''
            };

        case 'anonymous_tip':
            return {
                defendantName: document.getElementById('tipDefendantName')?.value || '',
                tip: document.getElementById('tipText')?.value || '',
                additionalDetails: document.getElementById('tipDetails')?.value || ''
            };

        default:
            return {};
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
    const steps = ['stepIdentify', 'stepType', 'stepContact', 'stepAddress',
        'stepExtension', 'stepCircumstances', 'stepTip', 'stepSuccess'];

    const current = steps.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });

    if (!current) return;

    // Back logic
    if (['stepContact', 'stepAddress', 'stepExtension', 'stepCircumstances'].includes(current)) {
        goToStep('stepType');
    } else if (current === 'stepType') {
        goToStep('stepIdentify');
        if (tg) tg.BackButton.hide();
    } else if (current === 'stepTip') {
        goToStep('stepIdentify');
        if (tg) tg.BackButton.hide();
        state.isAnonymous = false;
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
        updateType: null,
        isAnonymous: false,
        referenceId: ''
    };

    document.getElementById('lookupPhone').value = '';
    document.getElementById('lookupName').value = '';
    document.getElementById('btnContinueIdentity').disabled = true;

    // Clear all form fields
    document.querySelectorAll('.shamrock-input').forEach(input => {
        if (input.type !== 'tel' || input.id.startsWith('new')) {
            input.value = '';
        }
    });
    document.querySelectorAll('.shamrock-textarea').forEach(t => t.value = '');

    goToStep('stepIdentify');
    if (tg) {
        tg.BackButton.hide();
        tg.HapticFeedback.impactOccurred('light');
    }

    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        if (fullName) document.getElementById('lookupName').value = fullName;
    }
}
