/**
 * Shamrock Bail Bonds — Telegram Mini App
 * intake/app.js — uses globals from shared/brand.js (tg, tgUser, tgInitData)
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

var CONFIG = {
    GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec',
    ACTION: 'telegram_mini_app_intake',
    PAYMENT_LINK: 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8',
    PHONE: '(239) 332-2245'
};

// ═══════════════════════════════════════════════════════════════════════════
// FORM STATE
// ═══════════════════════════════════════════════════════════════════════════

var currentStep = 1;
var totalSteps = 5;
var locationData = null;
var uploadedFiles = {};

// ═══════════════════════════════════════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function nextStep() {
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
        if (field.type === 'file') {
            if ((!field.files || !field.files.length) && field.hasAttribute('required')) {
                valid = false;
                var fu = field.closest('.file-upload');
                if (fu) fu.classList.add('invalid');
                shake(fu);
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

    if (step === 2) {
        var email = document.getElementById('indEmail');
        if (email && email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
            email.classList.add('invalid');
            valid = false;
            shake(email);
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
// GPS LOCATION
// ═══════════════════════════════════════════════════════════════════════════

function captureLocation() {
    var btn = document.getElementById('locationBtn');
    btn.innerHTML = '<span class="spinner"></span> Capturing...';
    btn.disabled = true;

    if (tg && tg.LocationManager) {
        tg.LocationManager.init(function () {
            tg.LocationManager.getLocation(function (loc) {
                if (loc) setLocation(loc.latitude, loc.longitude);
                else browserGeolocation();
            });
        });
        return;
    }
    browserGeolocation();
}

function browserGeolocation() {
    if (!navigator.geolocation) {
        var btn = document.getElementById('locationBtn');
        btn.innerHTML = '<span class="loc-icon">📍</span> Location not available';
        btn.disabled = false;
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function (pos) { setLocation(pos.coords.latitude, pos.coords.longitude); },
        function () {
            var btn = document.getElementById('locationBtn');
            btn.innerHTML = '<span class="loc-icon">📍</span> Tap to retry';
            btn.disabled = false;
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
}

function setLocation(lat, lng) {
    locationData = { latitude: lat, longitude: lng };
    document.getElementById('gpsLat').value = lat;
    document.getElementById('gpsLng').value = lng;
    document.getElementById('locationBtn').classList.add('hidden');
    document.getElementById('locationResult').classList.remove('hidden');
    document.getElementById('locationDisplay').textContent = 'Location captured (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')';
    if (tg) tg.HapticFeedback.notificationOccurred('success');
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
        html += '<div class="review-section"><div class="review-section-title">📍 Location</div>' +
            '<div class="review-row"><span class="review-label">GPS</span><span class="review-value">' + locationData.latitude.toFixed(4) + ', ' + locationData.longitude.toFixed(4) + '</span></div></div>';
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
// FORM SUBMISSION
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
        action: CONFIG.ACTION,
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
        source: 'telegram_mini_app', platform: 'telegram',
        timestamp: new Date().toISOString(), consent: true
    };

    fetch(CONFIG.GAS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intakeData),
        mode: 'no-cors'
    }).then(function () {
        var ups = [];
        if (uploadedFiles.idFront) ups.push(uploadFileToGAS(uploadedFiles.idFront, 'id_front', intakeData.telegramUserId));
        if (uploadedFiles.idBack) ups.push(uploadFileToGAS(uploadedFiles.idBack, 'id_back', intakeData.telegramUserId));
        return Promise.all(ups);
    }).then(function () {
        if (tg) {
            tg.sendData(JSON.stringify({ type: 'intake_submitted', defName: intakeData.DefName, indName: intakeData.IndName, facility: intakeData.DefFacility, timestamp: intakeData.timestamp }));
        }
        showSuccess(intakeData);
    }).catch(function (error) {
        console.error('Submission error:', error);
        submitBtn.disabled = false;
        submitText.classList.remove('hidden');
        submitLoader.classList.add('hidden');
        if (tg) { tg.HapticFeedback.notificationOccurred('error'); tg.showAlert('Something went wrong. Please try again or call ' + CONFIG.PHONE); }
        else { alert('Something went wrong. Please try again or call ' + CONFIG.PHONE); }
    });
}

function uploadFileToGAS(file, docType, telegramUserId) {
    return new Promise(function (resolve) {
        try {
            var reader = new FileReader();
            reader.onload = function (e) {
                var base64 = e.target.result.split(',')[1];
                fetch(CONFIG.GAS_ENDPOINT, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'telegram_mini_app_upload', telegramUserId: telegramUserId, docType: docType, fileName: file.name, mimeType: file.type, base64Data: base64 }),
                    mode: 'no-cors'
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
// PHONE FORMATTING & REAL-TIME VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function initPhoneFormatting() {
    document.querySelectorAll('input[type="tel"]').forEach(function (field) {
        field.addEventListener('input', function (e) {
            var val = e.target.value.replace(/\D/g, '');
            if (val.length > 10) val = val.slice(0, 10);
            if (val.length >= 7) e.target.value = '(' + val.slice(0, 3) + ') ' + val.slice(3, 6) + '-' + val.slice(6);
            else if (val.length >= 4) e.target.value = '(' + val.slice(0, 3) + ') ' + val.slice(3);
            else if (val.length > 0) e.target.value = '(' + val;
        });
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
    // Intake-specific Telegram init (extends brand.js with pre-fill)
    if (tg) {
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation();
        document.body.classList.add('tg-themed');
        tgUser = tg.initDataUnsafe?.user;
        tgInitData = tg.initData;
        if (tgUser) {
            var fn = document.getElementById('indFirstName');
            var ln = document.getElementById('indLastName');
            if (fn && !fn.value && tgUser.first_name) fn.value = tgUser.first_name;
            if (ln && !ln.value && tgUser.last_name) ln.value = tgUser.last_name;
        }
        tg.BackButton.hide();
    }
    initFileUploads();
    initFacilityToggle();
    initPhoneFormatting();
    initRealTimeValidation();
    console.log('🍀 Shamrock Intake loaded');
});
