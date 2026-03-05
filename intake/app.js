/**
 * Shamrock Bail Bonds — Telegram Mini App
 * intake/app.js — uses globals from shared/brand.js:
 *   tg, tgUser, tgInitData, initTelegram, initTheme, toggleTheme,
 *   formatPhone, gasPost, captureLocationTiered,
 *   saveFormSession, loadFormSession, clearFormSession, debounce,
 *   SHAMROCK_GAS_ENDPOINT, SHAMROCK_PHONE, SHAMROCK_PAYMENT_LINK
 */

// ═══════════════════════════════════════════════════════════════════════════
// FORM STATE
// ═══════════════════════════════════════════════════════════════════════════

var currentStep = 1;
var totalSteps = 5;
var locationData = null;
var uploadedFiles = {};

// ═══════════════════════════════════════════════════════════════════════════
// SESSION PERSISTENCE — restore progress if user accidentally closed
// ═══════════════════════════════════════════════════════════════════════════

function saveIntakeSession() {
    var gv = function (id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    };
    saveFormSession('intake', {
        step: currentStep,
        defFirstName: gv('defFirstName'), defLastName: gv('defLastName'),
        defDOB: gv('defDOB'), defFacility: gv('defFacility'),
        defFacilityOther: gv('defFacilityOther'),
        defCharges: gv('defCharges'), defBondAmount: gv('defBondAmount'),
        indFirstName: gv('indFirstName'), indLastName: gv('indLastName'),
        indDOB: gv('indDOB'), indRelation: gv('indRelation'),
        indPhone: gv('indPhone'), indEmail: gv('indEmail'),
        indAddress: gv('indAddress'), indEmployer: gv('indEmployer'),
        indJobTitle: gv('indJobTitle'),
        ref1Name: gv('ref1Name'), ref1Phone: gv('ref1Phone'), ref1Relation: gv('ref1Relation'),
        ref2Name: gv('ref2Name'), ref2Phone: gv('ref2Phone'), ref2Relation: gv('ref2Relation'),
        locationData: locationData
    });
}

function restoreIntakeSession() {
    var saved = loadFormSession('intake');
    if (!saved) return;
    var fields = [
        'defFirstName', 'defLastName', 'defDOB', 'defFacility', 'defFacilityOther',
        'defCharges', 'defBondAmount',
        'indFirstName', 'indLastName', 'indDOB', 'indRelation',
        'indPhone', 'indEmail', 'indAddress', 'indEmployer', 'indJobTitle',
        'ref1Name', 'ref1Phone', 'ref1Relation',
        'ref2Name', 'ref2Phone', 'ref2Relation'
    ];
    fields.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && saved[id]) el.value = saved[id];
    });
    if (saved.defFacility === 'other') {
        var otherGroup = document.getElementById('defFacilityOtherGroup');
        if (otherGroup) otherGroup.classList.remove('hidden');
    }
    if (saved.locationData) {
        locationData = saved.locationData;
        setLocation(locationData.latitude, locationData.longitude, true);
    }
    if (saved.step && saved.step > 1) {
        currentStep = saved.step;
        showStep(currentStep);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function nextStep() {
    if (!validateStep(currentStep)) return;
    if (currentStep < totalSteps) {
        currentStep++;
        showStep(currentStep);
        saveIntakeSession();
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        showStep(currentStep);
    }
}

function showStep(step) {
    document.querySelectorAll('.form-step').forEach(function (s) { s.classList.remove('active'); });
    var target = document.querySelector('.form-step[data-step="' + step + '"]');
    if (target) target.classList.add('active');

    document.getElementById('currentStep').textContent = step;

    document.querySelectorAll('.dot').forEach(function (dot) {
        var dotStep = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'completed');
        if (dotStep === step) dot.classList.add('active');
        else if (dotStep < step) dot.classList.add('completed');
    });

    var progress = (step / totalSteps) * 100;
    document.getElementById('progressBar').style.width = progress + '%';

    var btnBack = document.getElementById('btnBack');
    var btnNext = document.getElementById('btnNext');
    var btnSubmit = document.getElementById('btnSubmit');

    if (step === 1) { btnBack.classList.add('hidden'); } else { btnBack.classList.remove('hidden'); }
    if (step === totalSteps) {
        btnNext.classList.add('hidden');
        btnSubmit.classList.remove('hidden');
        populateReview();
    } else {
        btnNext.classList.remove('hidden');
        btnSubmit.classList.add('hidden');
    }

    if (tg) {
        if (step > 1) { tg.BackButton.show(); tg.BackButton.onClick(prevStep); }
        else { tg.BackButton.hide(); }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateStep(step) {
    var section = document.querySelector('.form-step[data-step="' + step + '"]');
    if (!section) return true;

    var requiredFields = section.querySelectorAll('[required]');
    var valid = true;

    requiredFields.forEach(function (field) {
        if (field.closest('.hidden')) return;
        if (field.type === 'checkbox') {
            if (!field.checked) {
                valid = false;
                var cb = field.closest('.consent-box');
                if (cb) cb.classList.add('invalid-consent');
                shake(cb);
            } else {
                var cb2 = field.closest('.consent-box');
                if (cb2) cb2.classList.remove('invalid-consent');
            }
            return;
        }
        if (field.type === 'file') return; // files are always optional
        if (!field.value.trim()) {
            valid = false;
            field.classList.add('invalid');
            shake(field);
        } else {
            field.classList.remove('invalid');
        }
    });

    if (step === 2) {
        var email = document.getElementById('indEmail');
        if (email && email.value && !isValidEmail(email.value)) {
            email.classList.add('invalid');
            valid = false;
            shake(email);
        }
        var phone = document.getElementById('indPhone');
        if (phone && phone.value && !isValidPhone(phone.value)) {
            phone.classList.add('invalid');
            valid = false;
            shake(phone);
        }
    }

    if (!valid && tg) tg.HapticFeedback.notificationOccurred('error');
    return valid;
}

function shake(el) {
    if (!el) return;
    el.classList.add('shake-animation');
    setTimeout(function () { el.classList.remove('shake-animation'); }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// GPS LOCATION — uses brand.js captureLocationTiered (4-tier cascade)
// ═══════════════════════════════════════════════════════════════════════════

function captureLocation() {
    var btn = document.getElementById('locationBtn');
    var locText = btn.querySelector('.loc-text');
    btn.disabled = true;

    captureLocationTiered({
        onSuccess: function (lat, lng, source) {
            setLocation(lat, lng, false);
            console.log('[intake] Location captured via', source);
        },
        onManualFallback: function () {
            btn.disabled = false;
            if (locText) locText.textContent = 'Location unavailable';
            document.getElementById('manualLocationFallback').classList.remove('hidden');
        },
        onStatusUpdate: function (msg) {
            if (locText) locText.textContent = msg;
        }
    });
}

function setLocation(lat, lng, silent) {
    locationData = { latitude: lat, longitude: lng };
    document.getElementById('gpsLat').value = lat;
    document.getElementById('gpsLng').value = lng;
    document.getElementById('locationBtn').classList.add('hidden');
    document.getElementById('manualLocationFallback').classList.add('hidden');
    document.getElementById('locationResult').classList.remove('hidden');
    document.getElementById('locationDisplay').textContent = 'Location captured (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')';
    if (!silent && tg) tg.HapticFeedback.notificationOccurred('success');
}

function useManualLocation() {
    var city = document.getElementById('manualCity');
    if (!city || !city.value.trim()) {
        shake(city);
        return;
    }
    // Store city text as location data (no GPS coords)
    locationData = { manual: city.value.trim(), latitude: null, longitude: null };
    document.getElementById('locationBtn').classList.add('hidden');
    document.getElementById('manualLocationFallback').classList.add('hidden');
    document.getElementById('locationResult').classList.remove('hidden');
    document.getElementById('locationDisplay').textContent = '📍 ' + city.value.trim();
    if (tg) tg.HapticFeedback.notificationOccurred('success');
}

function skipIdUpload(e) {
    if (e) e.preventDefault();
    var frontUpload = document.getElementById('idFrontUpload');
    if (frontUpload) frontUpload.classList.add('hidden');
    var skipLink = e && e.target;
    if (skipLink) skipLink.textContent = '✓ Skipped — you can provide later';
    if (tg) tg.HapticFeedback.impactOccurred('light');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOADS
// ═══════════════════════════════════════════════════════════════════════════

function initFileUploads() {
    var idFront = document.getElementById('idFront');
    if (idFront) idFront.addEventListener('change', function (e) { handleFileSelect(e, 'idFront', 'idFrontPreview', 'idFrontUpload'); });
    var idBack = document.getElementById('idBack');
    if (idBack) idBack.addEventListener('change', function (e) { handleFileSelect(e, 'idBack', 'idBackPreview', 'idBackUpload'); });
}

function handleFileSelect(e, key, previewId, uploadId) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    uploadedFiles[key] = file;
    var preview = document.getElementById(previewId);
    var upload = document.getElementById(uploadId);
    if (file.type.startsWith('image/')) {
        var reader = new FileReader();
        reader.onload = function (ev) {
            preview.innerHTML = '<img src="' + ev.target.result + '" alt="Preview">';
            preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = '<p style="color: var(--green-light);">📄 ' + file.name + '</p>';
        preview.classList.remove('hidden');
    }
    upload.classList.add('has-file');
    if (tg) tg.HapticFeedback.impactOccurred('light');
}

// ═══════════════════════════════════════════════════════════════════════════
// FACILITY "OTHER" TOGGLE
// ═══════════════════════════════════════════════════════════════════════════

function initFacilityToggle() {
    var select = document.getElementById('defFacility');
    var otherGroup = document.getElementById('defFacilityOtherGroup');
    if (select) {
        select.addEventListener('change', function () {
            if (select.value === 'other') otherGroup.classList.remove('hidden');
            else otherGroup.classList.add('hidden');
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

function populateReview() {
    var gv = function (id) {
        var el = document.getElementById(id);
        if (!el) return '';
        if (el.tagName === 'SELECT') return (el.options[el.selectedIndex] && el.options[el.selectedIndex].text) || el.value;
        return el.value || '';
    };
    var facility = gv('defFacility') === "Other (I'll type it)" ? gv('defFacilityOther') : gv('defFacility');

    var html = '<div class="review-section"><div class="review-section-title">🚨 Defendant</div>' +
        '<div class="review-row"><span class="review-label">Name</span><span class="review-value">' + gv('defFirstName') + ' ' + gv('defLastName') + '</span></div>' +
        '<div class="review-row"><span class="review-label">DOB</span><span class="review-value">' + gv('defDOB') + '</span></div>' +
        '<div class="review-row"><span class="review-label">Facility</span><span class="review-value">' + facility + '</span></div>' +
        (gv('defCharges') ? '<div class="review-row"><span class="review-label">Charges</span><span class="review-value">' + gv('defCharges') + '</span></div>' : '') +
        (gv('defBondAmount') ? '<div class="review-row"><span class="review-label">Bond</span><span class="review-value">' + gv('defBondAmount') + '</span></div>' : '') +
        '</div><div class="review-section"><div class="review-section-title">🙋 Co-signer (You)</div>' +
        '<div class="review-row"><span class="review-label">Name</span><span class="review-value">' + gv('indFirstName') + ' ' + gv('indLastName') + '</span></div>' +
        '<div class="review-row"><span class="review-label">Phone</span><span class="review-value">' + gv('indPhone') + '</span></div>' +
        '<div class="review-row"><span class="review-label">Email</span><span class="review-value">' + gv('indEmail') + '</span></div>' +
        '<div class="review-row"><span class="review-label">Address</span><span class="review-value">' + gv('indAddress') + '</span></div>' +
        '</div><div class="review-section"><div class="review-section-title">💼 Employment</div>' +
        '<div class="review-row"><span class="review-label">Employer</span><span class="review-value">' + (gv('indEmployer') || 'Not provided') + '</span></div>' +
        '</div><div class="review-section"><div class="review-section-title">👥 References</div>' +
        '<div class="review-row"><span class="review-label">Ref 1</span><span class="review-value">' + gv('ref1Name') + ' — ' + gv('ref1Phone') + '</span></div>' +
        '<div class="review-row"><span class="review-label">Ref 2</span><span class="review-value">' + gv('ref2Name') + ' — ' + gv('ref2Phone') + '</span></div>' +
        '</div>';

    if (locationData) {
        var locDisplay = locationData.manual
            ? locationData.manual
            : (locationData.latitude.toFixed(4) + ', ' + locationData.longitude.toFixed(4));
        html += '<div class="review-section"><div class="review-section-title">📍 Location</div>' +
            '<div class="review-row"><span class="review-label">GPS</span><span class="review-value">' + locDisplay + '</span></div></div>';
    }
    if (Object.keys(uploadedFiles).length > 0) {
        html += '<div class="review-section"><div class="review-section-title">📄 Documents</div>' +
            (uploadedFiles.idFront ? '<div class="review-row"><span class="review-label">ID Front</span><span class="review-value">✅ Uploaded</span></div>' : '') +
            (uploadedFiles.idBack ? '<div class="review-row"><span class="review-label">ID Back</span><span class="review-value">✅ Uploaded</span></div>' : '') +
            '</div>';
    }
    document.getElementById('reviewSummary').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM SUBMISSION — uses brand.js gasPost() for real response handling
// ═══════════════════════════════════════════════════════════════════════════

function submitForm() {
    if (!validateStep(5)) return;

    var submitBtn = document.getElementById('btnSubmit');
    var submitText = submitBtn.querySelector('.btn-submit-text');
    var submitLoader = document.getElementById('submitLoader');
    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitLoader.classList.remove('hidden');
    if (tg) tg.HapticFeedback.impactOccurred('medium');

    var gv = function (id) { return (document.getElementById(id) && document.getElementById(id).value && document.getElementById(id).value.trim()) || ''; };
    var facility = gv('defFacility') === 'other' ? gv('defFacilityOther') : gv('defFacility');

    var intakeData = {
        action: 'telegram_mini_app_intake',
        initData: tgInitData,
        telegramUserId: tgUser ? String(tgUser.id) : '',
        telegramUsername: tgUser ? (tgUser.username || '') : '',
        DefFirstName: gv('defFirstName'), DefLastName: gv('defLastName'),
        DefName: gv('defFirstName') + ' ' + gv('defLastName'),
        DefDOB: gv('defDOB'), DefFacility: facility,
        DefCharges: gv('defCharges'), DefBondAmount: gv('defBondAmount'),
        IndFirstName: gv('indFirstName'), IndLastName: gv('indLastName'),
        IndName: gv('indFirstName') + ' ' + gv('indLastName'),
        IndDOB: gv('indDOB'), IndRelation: gv('indRelation'),
        IndPhone: gv('indPhone'), IndEmail: gv('indEmail'),
        IndAddress: gv('indAddress'), IndEmployer: gv('indEmployer'), IndJobTitle: gv('indJobTitle'),
        Ref1Name: gv('ref1Name'), Ref1Phone: gv('ref1Phone'), Ref1Relation: gv('ref1Relation'),
        Ref2Name: gv('ref2Name'), Ref2Phone: gv('ref2Phone'), Ref2Relation: gv('ref2Relation'),
        gpsLatitude: locationData ? locationData.latitude : null,
        gpsLongitude: locationData ? locationData.longitude : null,
        manualLocation: locationData ? (locationData.manual || null) : null,
        source: 'telegram_mini_app', platform: 'telegram',
        timestamp: new Date().toISOString(),
        consent: true,
        consentGiven: true,
        consentTimestamp: new Date().toISOString()
    };

    // 1. Instantly show success screen to make the app feel incredibly fast
    clearFormSession('intake');
    showSuccess();

    // 2. Process data in the background
    gasPost(SHAMROCK_GAS_ENDPOINT, intakeData)
        .then(function (result) {
            console.log('[intake] Submission result:', result);
            // Upload files in parallel
            var ups = [];
            if (uploadedFiles.idFront) ups.push(uploadFileToGAS(uploadedFiles.idFront, 'id_front', intakeData.telegramUserId));
            if (uploadedFiles.idBack) ups.push(uploadFileToGAS(uploadedFiles.idBack, 'id_back', intakeData.telegramUserId));
            return Promise.all(ups);
        })
        .then(function () {
            if (tg) {
                try {
                    tg.sendData(JSON.stringify({
                        type: 'intake_submitted',
                        defName: intakeData.DefName,
                        indName: intakeData.IndName,
                        facility: intakeData.DefFacility,
                        timestamp: intakeData.timestamp
                    }));
                } catch (e) { }
            }
        })
        .catch(function (error) {
            console.error('[intake] Background submission error:', error);
            // Since we already showed success, we might optionally alert the user or rely on staff
            if (tg) tg.showAlert('Warning: Network error. We have saved your info securely, but if you don\'t hear back shortly, please tap "Call Us Now".');
        });
}

function uploadFileToGAS(file, docType, telegramUserId) {
    return new Promise(function (resolve) {
        try {
            var reader = new FileReader();
            reader.onload = function (e) {
                var base64 = e.target.result.split(',')[1];
                gasPost(SHAMROCK_GAS_ENDPOINT, {
                    action: 'telegram_mini_app_upload',
                    telegramUserId: telegramUserId,
                    docType: docType,
                    fileName: file.name,
                    mimeType: file.type,
                    base64Data: base64
                }).then(function () { resolve(); }).catch(function () { resolve(); });
            };
            reader.readAsDataURL(file);
        } catch (err) { resolve(); }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUCCESS SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function showSuccess() {
    document.getElementById('successRefId').textContent = 'TG-' + Date.now().toString(36).toUpperCase();
    document.querySelector('.form-container').classList.add('hidden');
    document.querySelector('.form-footer').classList.add('hidden');
    document.querySelector('.progress-bar-container').classList.add('hidden');
    document.getElementById('successScreen').classList.remove('hidden');
    if (tg) { tg.HapticFeedback.notificationOccurred('success'); tg.BackButton.hide(); tg.disableClosingConfirmation(); }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHONE FORMATTING — uses brand.js formatPhone() + debounce()
// ═══════════════════════════════════════════════════════════════════════════

function initPhoneFormatting() {
    document.querySelectorAll('input[type="tel"]').forEach(function (field) {
        field.addEventListener('input', debounce(function (e) {
            e.target.value = formatPhone(e.target.value);
        }, 100));
    });
}

function initRealTimeValidation() {
    document.querySelectorAll('input, select, textarea').forEach(function (field) {
        field.addEventListener('input', function () {
            if (field.classList.contains('invalid') && field.value.trim()) field.classList.remove('invalid');
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

(function injectShakeCSS() {
    var style = document.createElement('style');
    style.textContent = '@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}.shake-animation{animation:shake .4s ease}.invalid-consent{border-color:#EF4444!important;box-shadow:0 0 0 3px rgba(239,68,68,.2)!important}';
    document.head.appendChild(style);
})();

document.addEventListener('DOMContentLoaded', function () {
    // Init Telegram (brand.js handles basics; we add intake-specific prefill)
    initTelegram();
    document.body.classList.add('tg-themed');

    // Pre-fill indemnitor name from Telegram user profile
    if (tgUser) {
        var fn = document.getElementById('indFirstName');
        var ln = document.getElementById('indLastName');
        if (fn && !fn.value && tgUser.first_name) fn.value = tgUser.first_name;
        if (ln && !ln.value && tgUser.last_name) ln.value = tgUser.last_name;
    }
    if (tg) tg.BackButton.hide();

    initFileUploads();
    initFacilityToggle();
    initPhoneFormatting();
    initRealTimeValidation();

    // Restore any saved session
    restoreIntakeSession();

    console.log('🍀 Shamrock Intake loaded — all brand.js utilities wired');
});
