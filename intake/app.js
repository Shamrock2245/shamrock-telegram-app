/**
 * Shamrock Bail Bonds — Telegram Mini App
 * app.js
 *
 * Form navigation, validation, Telegram WebApp SDK integration,
 * and GAS backend submission.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // GAS Web App URL — the doPost() endpoint
    // This is your deployed GAS web app URL (exec URL)
    GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec',

    // Action identifier so GAS knows this is from the Mini App
    ACTION: 'telegram_mini_app_intake',

    // Payment link
    PAYMENT_LINK: 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8',

    // Phone
    PHONE: '(239) 332-2245'
};

// ═══════════════════════════════════════════════════════════════════════════
// THEME TOGGLE (DARK / LIGHT)
// ═══════════════════════════════════════════════════════════════════════════

function initTheme() {
    const saved = localStorage.getItem('shamrock-theme');
    const theme = saved || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('shamrock-theme', next);

    if (tg) tg.HapticFeedback.impactOccurred('light');
}

// Initialize theme immediately (before DOMContentLoaded)
initTheme();

// ═══════════════════════════════════════════════════════════════════════════
// TELEGRAM WEBAPP SDK
// ═══════════════════════════════════════════════════════════════════════════

const tg = window.Telegram?.WebApp;
let tgUser = null;
let tgInitData = '';

function initTelegram() {
    if (!tg) {
        console.log('Not running inside Telegram — standalone mode');
        return;
    }

    // Tell Telegram we're ready
    tg.ready();

    // Expand to full height
    tg.expand();

    // Apply Telegram theme
    document.body.classList.add('tg-themed');

    // Enable closing confirmation
    tg.enableClosingConfirmation();

    // Get user data
    tgUser = tg.initDataUnsafe?.user;
    tgInitData = tg.initData;

    if (tgUser) {
        console.log('Telegram user:', tgUser.first_name, tgUser.last_name || '');

        // Pre-fill indemnitor name from Telegram profile
        const firstNameInput = document.getElementById('indFirstName');
        const lastNameInput = document.getElementById('indLastName');
        if (firstNameInput && !firstNameInput.value && tgUser.first_name) {
            firstNameInput.value = tgUser.first_name;
        }
        if (lastNameInput && !lastNameInput.value && tgUser.last_name) {
            lastNameInput.value = tgUser.last_name;
        }
    }

    // Hide Telegram's built-in back button initially
    tg.BackButton.hide();

    console.log('Telegram WebApp initialized');
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM STATE
// ═══════════════════════════════════════════════════════════════════════════

let currentStep = 1;
const totalSteps = 5;
let locationData = null;
let uploadedFiles = {};

// ═══════════════════════════════════════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function nextStep() {
    // Validate current step first
    if (!validateStep(currentStep)) return;

    if (currentStep < totalSteps) {
        currentStep++;
        showStep(currentStep);
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        showStep(currentStep);
    }
}

function showStep(step) {
    // Hide all steps
    document.querySelectorAll('.form-step').forEach(s => {
        s.classList.remove('active');
    });

    // Show target step
    const target = document.querySelector(`.form-step[data-step="${step}"]`);
    if (target) target.classList.add('active');

    // Update step indicator
    document.getElementById('currentStep').textContent = step;

    // Update dots
    document.querySelectorAll('.dot').forEach(dot => {
        const dotStep = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'completed');
        if (dotStep === step) dot.classList.add('active');
        else if (dotStep < step) dot.classList.add('completed');
    });

    // Update progress bar
    const progress = (step / totalSteps) * 100;
    document.getElementById('progressBar').style.width = progress + '%';

    // Update buttons
    const btnBack = document.getElementById('btnBack');
    const btnNext = document.getElementById('btnNext');
    const btnSubmit = document.getElementById('btnSubmit');

    if (step === 1) {
        btnBack.classList.add('hidden');
    } else {
        btnBack.classList.remove('hidden');
    }

    if (step === totalSteps) {
        btnNext.classList.add('hidden');
        btnSubmit.classList.remove('hidden');
        populateReview();
    } else {
        btnNext.classList.remove('hidden');
        btnSubmit.classList.add('hidden');
    }

    // Telegram back button
    if (tg) {
        if (step > 1) {
            tg.BackButton.show();
            tg.BackButton.onClick(prevStep);
        } else {
            tg.BackButton.hide();
        }
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateStep(step) {
    const section = document.querySelector(`.form-step[data-step="${step}"]`);
    if (!section) return true;

    const requiredFields = section.querySelectorAll('[required]');
    let valid = true;

    requiredFields.forEach(field => {
        // Skip hidden fields and file inputs on step 4 (optional location)
        if (field.closest('.hidden')) return;
        if (field.type === 'checkbox') {
            if (!field.checked) {
                valid = false;
                field.closest('.consent-box')?.classList.add('invalid-consent');
                shake(field.closest('.consent-box'));
            } else {
                field.closest('.consent-box')?.classList.remove('invalid-consent');
            }
            return;
        }
        if (field.type === 'file') {
            // File upload validation only if truly required
            if (!field.files?.length && field.hasAttribute('required')) {
                valid = false;
                field.closest('.file-upload')?.classList.add('invalid');
                shake(field.closest('.file-upload'));
            }
            return;
        }

        if (!field.value.trim()) {
            valid = false;
            field.classList.add('invalid');
            shake(field);
        } else {
            field.classList.remove('invalid');
        }
    });

    // Additional email validation
    if (step === 2) {
        const email = document.getElementById('indEmail');
        if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
            email.classList.add('invalid');
            valid = false;
            shake(email);
        }
    }

    // Haptic feedback on error
    if (!valid && tg) {
        tg.HapticFeedback.notificationOccurred('error');
    }

    return valid;
}

function shake(el) {
    if (!el) return;
    el.classList.add('shake-animation');
    setTimeout(() => el.classList.remove('shake-animation'), 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// GPS LOCATION
// ═══════════════════════════════════════════════════════════════════════════

function captureLocation() {
    const btn = document.getElementById('locationBtn');
    const result = document.getElementById('locationResult');
    const display = document.getElementById('locationDisplay');

    btn.innerHTML = '<span class="spinner"></span> Capturing...';
    btn.disabled = true;

    // Try Telegram's location first (smoother UX)
    if (tg?.LocationManager) {
        tg.LocationManager.init(() => {
            tg.LocationManager.getLocation((loc) => {
                if (loc) {
                    setLocation(loc.latitude, loc.longitude);
                } else {
                    // Fall back to browser geolocation
                    browserGeolocation();
                }
            });
        });
        return;
    }

    // Browser geolocation
    browserGeolocation();
}

function browserGeolocation() {
    if (!navigator.geolocation) {
        const btn = document.getElementById('locationBtn');
        btn.innerHTML = '<span class="loc-icon">📍</span> Location not available';
        btn.disabled = false;
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
        (err) => {
            console.error('Geolocation error:', err);
            const btn = document.getElementById('locationBtn');
            btn.innerHTML = '<span class="loc-icon">📍</span> Tap to retry';
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function setLocation(lat, lng) {
    locationData = { latitude: lat, longitude: lng };

    document.getElementById('gpsLat').value = lat;
    document.getElementById('gpsLng').value = lng;

    const btn = document.getElementById('locationBtn');
    const result = document.getElementById('locationResult');
    const display = document.getElementById('locationDisplay');

    btn.classList.add('hidden');
    result.classList.remove('hidden');
    display.textContent = `Location captured (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    if (tg) tg.HapticFeedback.notificationOccurred('success');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOADS
// ═══════════════════════════════════════════════════════════════════════════

function initFileUploads() {
    // ID Front
    const idFront = document.getElementById('idFront');
    if (idFront) {
        idFront.addEventListener('change', (e) => handleFileSelect(e, 'idFront', 'idFrontPreview', 'idFrontUpload'));
    }

    // ID Back
    const idBack = document.getElementById('idBack');
    if (idBack) {
        idBack.addEventListener('change', (e) => handleFileSelect(e, 'idBack', 'idBackPreview', 'idBackUpload'));
    }
}

function handleFileSelect(e, key, previewId, uploadId) {
    const file = e.target.files?.[0];
    if (!file) return;

    uploadedFiles[key] = file;

    const preview = document.getElementById(previewId);
    const upload = document.getElementById(uploadId);

    // Show preview
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            preview.innerHTML = `<img src="${ev.target.result}" alt="Preview">`;
            preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = `<p style="color: var(--green-light);">📄 ${file.name}</p>`;
        preview.classList.remove('hidden');
    }

    upload.classList.add('has-file');

    if (tg) tg.HapticFeedback.impactOccurred('light');
}

// ═══════════════════════════════════════════════════════════════════════════
// FACILITY "OTHER" TOGGLE
// ═══════════════════════════════════════════════════════════════════════════

function initFacilityToggle() {
    const select = document.getElementById('defFacility');
    const otherGroup = document.getElementById('defFacilityOtherGroup');

    if (select) {
        select.addEventListener('change', () => {
            if (select.value === 'other') {
                otherGroup.classList.remove('hidden');
            } else {
                otherGroup.classList.add('hidden');
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

function populateReview() {
    const getValue = (id) => {
        const el = document.getElementById(id);
        if (!el) return '';
        if (el.tagName === 'SELECT') {
            return el.options[el.selectedIndex]?.text || el.value;
        }
        return el.value || '';
    };

    const facility = getValue('defFacility') === 'Other (I\'ll type it)'
        ? getValue('defFacilityOther')
        : getValue('defFacility');

    const html = `
    <div class="review-section">
      <div class="review-section-title">🚨 Defendant</div>
      <div class="review-row"><span class="review-label">Name</span><span class="review-value">${getValue('defFirstName')} ${getValue('defLastName')}</span></div>
      <div class="review-row"><span class="review-label">DOB</span><span class="review-value">${getValue('defDOB')}</span></div>
      <div class="review-row"><span class="review-label">Facility</span><span class="review-value">${facility}</span></div>
      ${getValue('defCharges') ? `<div class="review-row"><span class="review-label">Charges</span><span class="review-value">${getValue('defCharges')}</span></div>` : ''}
      ${getValue('defBondAmount') ? `<div class="review-row"><span class="review-label">Bond</span><span class="review-value">${getValue('defBondAmount')}</span></div>` : ''}
    </div>
    <div class="review-section">
      <div class="review-section-title">🙋 Co-signer (You)</div>
      <div class="review-row"><span class="review-label">Name</span><span class="review-value">${getValue('indFirstName')} ${getValue('indLastName')}</span></div>
      <div class="review-row"><span class="review-label">Phone</span><span class="review-value">${getValue('indPhone')}</span></div>
      <div class="review-row"><span class="review-label">Email</span><span class="review-value">${getValue('indEmail')}</span></div>
      <div class="review-row"><span class="review-label">Address</span><span class="review-value">${getValue('indAddress')}</span></div>
    </div>
    <div class="review-section">
      <div class="review-section-title">💼 Employment</div>
      <div class="review-row"><span class="review-label">Employer</span><span class="review-value">${getValue('indEmployer') || 'Not provided'}</span></div>
    </div>
    <div class="review-section">
      <div class="review-section-title">👥 References</div>
      <div class="review-row"><span class="review-label">Ref 1</span><span class="review-value">${getValue('ref1Name')} — ${getValue('ref1Phone')}</span></div>
      <div class="review-row"><span class="review-label">Ref 2</span><span class="review-value">${getValue('ref2Name')} — ${getValue('ref2Phone')}</span></div>
    </div>
    ${locationData ? `
    <div class="review-section">
      <div class="review-section-title">📍 Location</div>
      <div class="review-row"><span class="review-label">GPS</span><span class="review-value">${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)}</span></div>
    </div>` : ''}
    ${Object.keys(uploadedFiles).length > 0 ? `
    <div class="review-section">
      <div class="review-section-title">📄 Documents</div>
      ${uploadedFiles.idFront ? `<div class="review-row"><span class="review-label">ID Front</span><span class="review-value">✅ Uploaded</span></div>` : ''}
      ${uploadedFiles.idBack ? `<div class="review-row"><span class="review-label">ID Back</span><span class="review-value">✅ Uploaded</span></div>` : ''}
    </div>` : ''}
  `;

    document.getElementById('reviewSummary').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM SUBMISSION
// ═══════════════════════════════════════════════════════════════════════════

async function submitForm() {
    // Final validation
    if (!validateStep(5)) return;

    const submitBtn = document.getElementById('btnSubmit');
    const submitText = submitBtn.querySelector('.btn-submit-text');
    const submitLoader = document.getElementById('submitLoader');

    // Show loading state
    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitLoader.classList.remove('hidden');

    if (tg) tg.HapticFeedback.impactOccurred('medium');

    try {
        const getValue = (id) => document.getElementById(id)?.value?.trim() || '';

        const facility = getValue('defFacility') === 'other'
            ? getValue('defFacilityOther')
            : getValue('defFacility');

        // Build the intake data object matching the canonical schema
        const intakeData = {
            // Action for GAS router
            action: CONFIG.ACTION,

            // Telegram auth data (for server-side validation)
            initData: tgInitData,
            telegramUserId: tgUser?.id?.toString() || '',
            telegramUsername: tgUser?.username || '',

            // Defendant
            DefFirstName: getValue('defFirstName'),
            DefLastName: getValue('defLastName'),
            DefName: `${getValue('defFirstName')} ${getValue('defLastName')}`,
            DefDOB: getValue('defDOB'),
            DefFacility: facility,
            DefCharges: getValue('defCharges'),
            DefBondAmount: getValue('defBondAmount'),

            // Indemnitor
            IndFirstName: getValue('indFirstName'),
            IndLastName: getValue('indLastName'),
            IndName: `${getValue('indFirstName')} ${getValue('indLastName')}`,
            IndDOB: getValue('indDOB'),
            IndRelation: getValue('indRelation'),
            IndPhone: getValue('indPhone'),
            IndEmail: getValue('indEmail'),
            IndAddress: getValue('indAddress'),
            IndEmployer: getValue('indEmployer'),
            IndJobTitle: getValue('indJobTitle'),

            // References
            Ref1Name: getValue('ref1Name'),
            Ref1Phone: getValue('ref1Phone'),
            Ref1Relation: getValue('ref1Relation'),
            Ref2Name: getValue('ref2Name'),
            Ref2Phone: getValue('ref2Phone'),
            Ref2Relation: getValue('ref2Relation'),

            // GPS
            gpsLatitude: locationData?.latitude || null,
            gpsLongitude: locationData?.longitude || null,

            // Metadata
            source: 'telegram_mini_app',
            platform: 'telegram',
            timestamp: new Date().toISOString(),
            consent: true
        };

        console.log('Submitting intake:', JSON.stringify(intakeData, null, 2));

        // Submit to GAS
        const response = await fetch(CONFIG.GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(intakeData),
            mode: 'no-cors' // GAS doesn't support CORS for doPost
        });

        // Note: with no-cors, response is opaque — we can't read it.
        // GAS doPost will process the data and we show success optimistically.

        // Handle file uploads separately if needed
        if (uploadedFiles.idFront) {
            await uploadFileToGAS(uploadedFiles.idFront, 'id_front', intakeData.telegramUserId);
        }
        if (uploadedFiles.idBack) {
            await uploadFileToGAS(uploadedFiles.idBack, 'id_back', intakeData.telegramUserId);
        }

        // Also send data back to bot via Telegram SDK
        if (tg) {
            tg.sendData(JSON.stringify({
                type: 'intake_submitted',
                defName: intakeData.DefName,
                indName: intakeData.IndName,
                facility: intakeData.DefFacility,
                timestamp: intakeData.timestamp
            }));
        }

        // Show success screen
        showSuccess(intakeData);

    } catch (error) {
        console.error('Submission error:', error);

        // Reset button
        submitBtn.disabled = false;
        submitText.classList.remove('hidden');
        submitLoader.classList.add('hidden');

        if (tg) {
            tg.HapticFeedback.notificationOccurred('error');
            tg.showAlert('Something went wrong. Please try again or call ' + CONFIG.PHONE);
        } else {
            alert('Something went wrong. Please try again or call ' + CONFIG.PHONE);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOAD TO GAS
// ═══════════════════════════════════════════════════════════════════════════

async function uploadFileToGAS(file, docType, telegramUserId) {
    try {
        const reader = new FileReader();
        return new Promise((resolve) => {
            reader.onload = async (e) => {
                const base64 = e.target.result.split(',')[1]; // Remove data:...;base64, prefix

                await fetch(CONFIG.GAS_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'telegram_mini_app_upload',
                        telegramUserId: telegramUserId,
                        docType: docType,
                        fileName: file.name,
                        mimeType: file.type,
                        base64Data: base64
                    }),
                    mode: 'no-cors'
                });

                resolve();
            };
            reader.readAsDataURL(file);
        });
    } catch (err) {
        console.error('File upload error:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUCCESS SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function showSuccess(data) {
    // Generate reference ID
    const refId = 'TG-' + Date.now().toString(36).toUpperCase();
    document.getElementById('successRefId').textContent = refId;

    // Hide form, show success
    document.querySelector('.form-container').classList.add('hidden');
    document.querySelector('.form-footer').classList.add('hidden');
    document.querySelector('.progress-bar-container').classList.add('hidden');
    document.getElementById('successScreen').classList.remove('hidden');

    if (tg) {
        tg.HapticFeedback.notificationOccurred('success');
        tg.BackButton.hide();
        tg.disableClosingConfirmation();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHONE FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

function initPhoneFormatting() {
    const phoneFields = document.querySelectorAll('input[type="tel"]');
    phoneFields.forEach(field => {
        field.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 10) val = val.slice(0, 10);

            if (val.length >= 7) {
                e.target.value = `(${val.slice(0, 3)}) ${val.slice(3, 6)}-${val.slice(6)}`;
            } else if (val.length >= 4) {
                e.target.value = `(${val.slice(0, 3)}) ${val.slice(3)}`;
            } else if (val.length > 0) {
                e.target.value = `(${val}`;
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION (real-time)
// ═══════════════════════════════════════════════════════════════════════════

function initRealTimeValidation() {
    document.querySelectorAll('input, select, textarea').forEach(field => {
        field.addEventListener('input', () => {
            if (field.classList.contains('invalid') && field.value.trim()) {
                field.classList.remove('invalid');
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// SHAKE ANIMATION (CSS injection)
// ═══════════════════════════════════════════════════════════════════════════

function injectShakeCSS() {
    const style = document.createElement('style');
    style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
    .shake-animation {
      animation: shake 0.4s ease;
    }
    .invalid-consent {
      border-color: #EF4444 !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2) !important;
    }
  `;
    document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initFileUploads();
    initFacilityToggle();
    initPhoneFormatting();
    initRealTimeValidation();
    injectShakeCSS();

    console.log('🍀 Shamrock Mini App loaded');
});
