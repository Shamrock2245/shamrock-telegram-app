/**
 * Shamrock paperwork popup — Netlify mini-app.
 * Pipeline: this UI → /api/paperwork → Super CRM PIN portal → DocuSeal.
 * Never creates a packet. Signing only opens if staff already issued one.
 */

const API = '/api/paperwork';
const SIGN_HOST = 'https://sign.shamrockbailbonds.biz';
const SIGN_EMBED_HOST = 'sign.shamrockbailbonds.biz';

const ROLE_COPY = {
    indemnitor: {
        label: 'Indemnitor (co-signer)',
        fieldsTitle: 'A few details we still need',
        fieldsSub: 'Bond amount, POA, and charges stay with your bondsman. Fill what you know.',
    },
    coindemnitor: {
        label: 'Co-indemnitor',
        fieldsTitle: 'A few details we still need',
        fieldsSub: 'Confirm your name and how you know the defendant. Skip anything you do not know.',
    },
    defendant: {
        label: 'Defendant',
        fieldsTitle: 'Confirm your details',
        fieldsSub: 'We only need your identity. Premium and court fields stay with the office.',
    },
};

const state = {
    phone: '',
    sessionToken: '',
    extracted: {},
    packet: null,
    selfieReady: false,
    idFile: null,
    role: '',
    cameraStream: null,
    cameraFacingMode: 'environment',
    isKiosk: false,
};

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTelegram();
    bindUi();
    applyQuery();
    if (window !== window.parent) {
        document.body.classList.add('embed');
        const back = document.getElementById('backLink');
        if (back) back.classList.add('hidden');
    }
});

function bindUi() {
    const phoneInput = document.getElementById('phoneInput');
    phoneInput.addEventListener('input', () => {
        phoneInput.value = formatPhone(phoneInput.value);
    });
    document.getElementById('roleDefendantBtn').addEventListener('click', () => chooseRole('defendant'));
    document.getElementById('roleIndemnitorBtn').addEventListener('click', () => chooseRole('indemnitor'));
    document.getElementById('sendPinBtn').addEventListener('click', sendPin);
    document.getElementById('verifyPinBtn').addEventListener('click', verifyPin);
    document.getElementById('scanIdBtn').addEventListener('click', scanId);
    document.getElementById('startCameraBtn').addEventListener('click', startCamera);
    document.getElementById('flipCameraBtn').addEventListener('click', flipCamera);
    document.getElementById('snapPhotoBtn').addEventListener('click', snapPhoto);
    document.getElementById('manualDetailsBtn').addEventListener('click', skipToManualEntry);
    const manualLink = document.getElementById('manualDetailsLink');
    if (manualLink) manualLink.addEventListener('click', skipToManualEntry);
    document.getElementById('openFieldsBtn').addEventListener('click', () => openPopup('fields'));
    document.getElementById('saveFieldsBtn').addEventListener('click', saveFields);
    document.getElementById('confirmAddressBtn').addEventListener('click', confirmAddress);
    document.getElementById('openSignBtn').addEventListener('click', openSigning);
    document.getElementById('exitSignBtn').addEventListener('click', () => showScreen('ready'));
    document.getElementById('selfieInput').addEventListener('change', onSelfie);
    document.getElementById('idInput').addEventListener('change', onIdFile);
    document.getElementById('staffReviewAcknowledgment').addEventListener('change', () => setStatus('fieldsStatus', '', ''));
    document.getElementById('pinInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyPin();
    });
    document.getElementById('phoneInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendPin();
    });
    document.querySelectorAll('[data-close]').forEach((el) => {
        el.addEventListener('click', () => closePopup(el.getAttribute('data-close')));
    });
}

function applyQuery() {
    const q = new URLSearchParams(window.location.search);
    if (q.get('embed') === '1') document.body.classList.add('embed');
    const isKioskMode = q.get('kiosk') === '1' || q.get('mode') === 'kiosk' || q.get('source') === 'wix-lobby-tablet';
    if (isKioskMode) {
        state.isKiosk = true;
        const badge = document.getElementById('kioskBadge');
        if (badge) badge.classList.remove('hidden');
        const idTitle = document.getElementById('identityTitle');
        if (idTitle) idTitle.textContent = 'Scan ID or Enter Details';
        const idCopy = document.getElementById('identityCopy');
        if (idCopy) idCopy.textContent = 'Position your ID inside the tablet camera box or enter details manually.';
    }
    const phone = (q.get('phone') || '').replace(/\D/g, '');
    if (phone.length >= 10) {
        state.phone = phone.slice(-10);
        document.getElementById('phoneInput').value = formatPhone(state.phone);
    }
    const role = normalizeRole(q.get('role') || '');
    if (role) applyRole(role);
    const token = q.get('st') || q.get('token') || q.get('session') || '';
    if (token) {
        state.sessionToken = token;
        restoreSession();
        return;
    }
    const link = q.get('link') || q.get('s') || '';
    if (link) {
        state.packet = { signing_link: normalizeSignUrl(link), has_packet: true };
    }
    if (state.role) {
        showScreen('unlock');
    } else {
        showScreen('role');
    }
}

function normalizeRole(role) {
    const raw = String(role || '').trim().toLowerCase();
    if (raw === 'def' || raw === 'inmate') return 'defendant';
    if (raw === 'co-indemnitor' || raw === 'co_indemnitor' || raw === 'co') return 'coindemnitor';
    if (raw === 'ind' || raw === 'cosigner' || raw === 'co-signer') return 'indemnitor';
    return raw;
}

function chooseRole(role) {
    const normalized = normalizeRole(role);
    if (!['defendant', 'indemnitor', 'coindemnitor'].includes(normalized)) {
        setStatus('roleStatus', 'Choose the role that describes you.', 'error');
        return;
    }
    applyRole(normalized);
    setStatus('roleStatus', '', '');
    showScreen('unlock');
}

function applyRole(role) {
    state.role = normalizeRole(role);
    const copy = ROLE_COPY[state.role] || ROLE_COPY.indemnitor;
    const readyRole = document.getElementById('readyRole');
    if (readyRole) readyRole.textContent = copy.label;
    const fieldsTitle = document.getElementById('fieldsTitle');
    const fieldsSub = document.getElementById('fieldsSub');
    if (fieldsTitle) fieldsTitle.textContent = copy.fieldsTitle;
    if (fieldsSub) fieldsSub.textContent = copy.fieldsSub;
    const cosigner = document.getElementById('cosignerFields');
    const defDl = document.getElementById('rowDefendantDl');
    const isDefendant = state.role === 'defendant';
    if (cosigner) cosigner.classList.toggle('hidden', isDefendant);
    if (defDl) defDl.classList.toggle('hidden', !isDefendant);
}

async function api(action, body, { form } = {}) {
    const opts = { method: 'POST' };
    if (form) {
        form.set('action', action);
        opts.body = form;
    } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify({ action, ...body });
    }
    const res = await fetch(API, opts);
    const data = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
    if (!res.ok && !data.error) data.error = 'Request failed';
    return data;
}

function setStatus(id, message, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'status-line' + (kind ? ' ' + kind : '');
}

function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    document.body.classList.toggle('signing-mode', name === 'sign');
    const map = { role: 'role', unlock: 'unlock', identity: 'identity', ready: 'fields', sign: 'sign', blocked: 'fields', done: 'sign' };
    document.querySelectorAll('.step-pill').forEach((pill) => {
        pill.classList.toggle('active', pill.getAttribute('data-step') === map[name]);
    });
}

function openPopup(name) {
    const el = document.getElementById('popup-' + name);
    if (!el) return;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('open'));
}

function closePopup(name) {
    if (name === 'camera') stopCamera();
    const el = document.getElementById('popup-' + name);
    if (!el) return;
    el.classList.remove('open');
    setTimeout(() => { el.hidden = true; }, 180);
}

async function sendPin() {
    const phone = document.getElementById('phoneInput').value.replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
        setStatus('unlockStatus', 'Enter a valid 10-digit mobile number.', 'error');
        return;
    }
    state.phone = phone;
    setStatus('unlockStatus', 'Sending PIN…');
    if (!state.role) {
        showScreen('role');
        setStatus('roleStatus', 'Choose whether you are the defendant or an indemnitor first.', 'error');
        return;
    }
    const data = await api('send-pin', { phone, role: state.role });
    if (!data.success) {
        setStatus('unlockStatus', data.error || 'Could not send PIN.', 'error');
        return;
    }
    document.getElementById('pinRow').classList.remove('hidden');
    document.getElementById('pinInput').focus();
    setStatus('unlockStatus', 'PIN sent. Check iMessage or text.', 'ok');
}

async function verifyPin() {
    const pin = document.getElementById('pinInput').value.trim();
    if (pin.length < 4) {
        setStatus('unlockStatus', 'Enter the 6-digit PIN.', 'error');
        return;
    }
    setStatus('unlockStatus', 'Verifying…');
    const data = await api('verify-pin', { phone: state.phone, pin });
    if (!data.success) {
        setStatus('unlockStatus', data.error || 'Invalid PIN.', 'error');
        return;
    }
    applySession(data);
    if (!state.role) {
        showScreen('role');
        return;
    }
    showScreen('identity');
}

async function restoreSession() {
    setStatus('unlockStatus', 'Restoring your session…');
    const data = await api('session', { session_token: state.sessionToken });
    if (!data.success) {
        setStatus('unlockStatus', data.error || 'Session expired. Request a new PIN.', 'error');
        return;
    }
    applySession(data);
    if (!state.role) {
        showScreen('role');
    } else if (data.extracted && data.extracted.full_name) {
        fillFromExtracted(data.extracted);
        showScreen('ready');
    } else {
        showScreen('identity');
    }
}

function applySession(data) {
    state.sessionToken = data.session_token || state.sessionToken;
    state.phone = (data.phone || state.phone || '').replace(/\D/g, '').slice(-10);
    state.packet = data;
    state.extracted = data.extracted || state.extracted || {};
    if (state.phone) document.getElementById('phoneInput').value = formatPhone(state.phone);
    document.getElementById('readyDefendant').textContent = data.defendant_name || 'On file';
    document.getElementById('readyPacket').textContent = data.packet_id || (data.has_packet ? 'Ready' : 'Not issued yet');
    if (data.role && !state.role) applyRole(data.role);
    if (data.has_packet && data.signing_link) {
        document.getElementById('openSignBtn').classList.remove('hidden');
        setStatus('readyStatus', 'Staff has already issued final DocuSeal paperwork. Review your information first, then you may sign.', 'ok');
    } else {
        document.getElementById('blockedCopy').textContent = data.message
            || 'Your intake is saved. A Shamrock bondsman will connect the right people and complete the final bond details before issuing paperwork, if needed.';
    }
}

function onSelfie(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    state.selfieReady = true;
    document.getElementById('selfieLabel').textContent = 'Selfie captured';
    api('selfie', { session_token: state.sessionToken }).catch(() => {});
    maybeEnableScan();
}

function onIdFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    state.idFile = file;
    document.getElementById('idLabel').textContent = file.name || 'ID selected';
    const preview = document.getElementById('idPreview');
    preview.classList.remove('hidden');
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" style="max-height:120px;border-radius:8px;border:1px solid var(--border-color);margin-bottom:8px;display:block;"><span>${file.name}</span>`;
    maybeEnableScan();
    scanId();
}

function maybeEnableScan() {
    const btn = document.getElementById('scanIdBtn');
    if (btn) {
        btn.disabled = !state.idFile;
        if (state.idFile) btn.classList.remove('hidden');
    }
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('identityStatus', 'Live camera stream not supported on this browser. Opening file capture.', 'info');
        document.getElementById('idInput').click();
        return;
    }
    stopCamera();
    setStatus('identityStatus', 'Starting camera…', 'info');
    try {
        const constraints = {
            video: {
                facingMode: { ideal: state.cameraFacingMode },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            // Fallback for tablets/kiosks with single camera or facingMode rejection
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        state.cameraStream = stream;
        const video = document.getElementById('cameraVideo');
        video.srcObject = stream;
        await video.play();
        openPopup('camera');
        setStatus('identityStatus', '', '');
    } catch (err) {
        console.warn('Camera access error:', err);
        setStatus('identityStatus', 'Camera access blocked. Opening file upload.', 'warning');
        document.getElementById('idInput').click();
    }
}

function stopCamera() {
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach((track) => track.stop());
        state.cameraStream = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) video.srcObject = null;
}

function flipCamera() {
    state.cameraFacingMode = state.cameraFacingMode === 'environment' ? 'user' : 'environment';
    startCamera();
}

function snapPhoto() {
    const video = document.getElementById('cameraVideo');
    if (!video || !video.videoWidth) {
        setStatus('identityStatus', 'Camera not ready. Please try again.', 'error');
        return;
    }
    const canvas = document.getElementById('cameraCanvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
        if (!blob) return;
        stopCamera();
        closePopup('camera');
        state.idFile = new File([blob], 'camera-id.jpg', { type: 'image/jpeg' });
        document.getElementById('idLabel').textContent = 'Camera photo captured';
        const preview = document.getElementById('idPreview');
        preview.classList.remove('hidden');
        preview.innerHTML = `<img src="${URL.createObjectURL(blob)}" style="max-height:120px;border-radius:8px;border:1px solid var(--border-color);margin-bottom:8px;display:block;"><span>Photo captured from camera</span>`;
        maybeEnableScan();
        scanId();
    }, 'image/jpeg', 0.90);
}

function skipToManualEntry() {
    stopCamera();
    closePopup('camera');
    setStatus('identityStatus', 'Entering details manually. Staff will verify your ID.', 'ok');
    showScreen('ready');
    openPopup('fields');
}

async function scanId() {
    if (!state.idFile) return;
    setStatus('identityStatus', 'Scanning ID with AI Vision…');
    const form = new FormData();
    form.set('session_token', state.sessionToken);
    form.set('file', state.idFile, state.idFile.name || 'id.jpg');
    try {
        const data = await api('id-ocr', {}, { form });
        if (!data.success || !data.extracted || !Object.keys(data.extracted).length) {
            setStatus('identityStatus', 'Could not auto-read ID clearly. Please review or enter your details manually.', 'warning');
            showScreen('ready');
            openPopup('fields');
            return;
        }
        state.extracted = data.extracted;
        fillFromExtracted(data.extracted);
        const preview = document.getElementById('idPreview');
        preview.classList.remove('hidden');
        const details = [data.extracted.full_name, data.extracted.dob, data.extracted.dl_number].filter(Boolean).join(' · ');
        preview.textContent = details ? `Verified: ${details}` : 'ID read successfully.';
        setStatus('identityStatus', 'ID read. Review the address and your role-specific details.', 'ok');
        openPopup('address');
    } catch (err) {
        console.warn('ID OCR non-fatal:', err);
        setStatus('identityStatus', 'Could not reach scanner service. You can enter details manually.', 'warning');
        showScreen('ready');
        openPopup('fields');
    }
}

function fillFromExtracted(ext) {
    const street = ext.address || '';
    const city = ext.city || '';
    const stateVal = ext.state || ext.dl_state || '';
    const zip = ext.zip || '';
    const name = ext.full_name || '';
    const dl = ext.dl_number || '';
    const dob = ext.dob || '';

    // Popup-address inputs
    const elAddrStreet = document.getElementById('addrStreet');
    if (elAddrStreet) elAddrStreet.value = street;
    const elAddrCity = document.getElementById('addrCity');
    if (elAddrCity) elAddrCity.value = city;
    const elAddrState = document.getElementById('addrState');
    if (elAddrState) elAddrState.value = stateVal;
    const elAddrZip = document.getElementById('addrZip');
    if (elAddrZip) elAddrZip.value = zip;

    // Popup-fields inputs
    const elFieldsStreet = document.getElementById('fieldsStreet');
    if (elFieldsStreet) elFieldsStreet.value = street;
    const elFieldsCity = document.getElementById('fieldsCity');
    if (elFieldsCity) elFieldsCity.value = city;
    const elFieldsState = document.getElementById('fieldsState');
    if (elFieldsState) elFieldsState.value = stateVal;
    const elFieldsZip = document.getElementById('fieldsZip');
    if (elFieldsZip) elFieldsZip.value = zip;

    const elName = document.getElementById('fieldName');
    if (elName && name) elName.value = name;
    const elDob = document.getElementById('fieldDob');
    if (elDob && dob) elDob.value = dob;

    const defDl = document.getElementById('fieldDefendantDl');
    const indDl = document.getElementById('fieldDl');
    if (state.role === 'defendant') {
        if (defDl && dl) defDl.value = dl;
    } else {
        if (indDl && dl) indDl.value = dl;
    }
}

function confirmAddress() {
    // Sync address fields to popup-fields
    const elStreet = document.getElementById('fieldsStreet');
    if (elStreet && !elStreet.value) elStreet.value = val('addrStreet');
    const elCity = document.getElementById('fieldsCity');
    if (elCity && !elCity.value) elCity.value = val('addrCity');
    const elState = document.getElementById('fieldsState');
    if (elState && !elState.value) elState.value = val('addrState');
    const elZip = document.getElementById('fieldsZip');
    if (elZip && !elZip.value) elZip.value = val('addrZip');

    closePopup('address');
    showScreen('ready');
    openPopup('fields');
}

function collectFields() {
    const street = val('fieldsStreet') || val('addrStreet');
    const city = val('fieldsCity') || val('addrCity');
    const stateVal = val('fieldsState') || val('addrState');
    const zip = val('fieldsZip') || val('addrZip');
    const dob = val('fieldDob') || (state.extracted && state.extracted.dob) || '';

    if (state.role === 'defendant') {
        return {
            defendant_name: val('fieldName'),
            defendant_address: street,
            defendant_city: city,
            defendant_state: stateVal,
            defendant_zip: zip,
            defendant_dl: val('fieldDefendantDl') || val('fieldDl'),
            defendant_dob: dob,
        };
    }
    const ref = document.getElementById('fieldRef1').value.trim();
    const [refName, refPhone] = splitRef(ref);
    return {
        indemnitor_name: val('fieldName'),
        IndemnitorName: val('fieldName'),
        FullName: val('fieldName'),
        indemnitor_address: street,
        indemnitor_city: city,
        indemnitor_state: stateVal,
        indemnitor_zip: zip,
        indemnitor_dl: val('fieldDl'),
        indemnitor_dob: dob,
        indemnitor_relationship: val('fieldRelationship'),
        indemnitor_employer: val('fieldEmployer'),
        indemnitor_employer_phone: val('fieldEmployerPhone'),
        indemnitor_work_phone: val('fieldEmployerPhone'),
        indemnitor_employer_address: val('fieldEmployerAddress'),
        indemnitor_vehicle_year: val('fieldVehicleYear'),
        indemnitor_vehicle_make: val('fieldVehicleMake'),
        indemnitor_vehicle_model: val('fieldVehicleModel'),
        indemnitor_vehicle_color: val('fieldVehicleColor'),
        reference_1_name: refName,
        reference_1_phone: refPhone,
    };
}

function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function splitRef(raw) {
    if (!raw) return ['', ''];
    const match = raw.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
    if (!match) return [raw, ''];
    return [raw.replace(match[0], '').replace(/[,\-–]+$/, '').trim(), match[0]];
}

async function saveFields() {
    if (!state.role) {
        showScreen('role');
        return;
    }
    if (!document.getElementById('staffReviewAcknowledgment').checked) {
        setStatus('fieldsStatus', 'Please acknowledge that Shamrock staff will verify the case and complete the final paperwork.', 'error');
        return;
    }
    setStatus('fieldsStatus', 'Saving your secure intake…');
    const data = await api('fields', {
        session_token: state.sessionToken,
        role: state.role,
        address_confirmed: true,
        staff_review_acknowledged: true,
        fields: collectFields(),
    });
    if (!data.success) {
        setStatus('fieldsStatus', data.error || 'Could not save details.', 'error');
        return;
    }
    applySession({ ...state.packet, ...data, session_token: state.sessionToken });
    closePopup('fields');
    if (data.has_packet && data.signing_link) {
        document.getElementById('openSignBtn').classList.remove('hidden');
        setStatus('readyStatus', 'Your information is saved to the final packet. You can sign now.', 'ok');
        openSigning();
        return;
    }
    document.getElementById('blockedCopy').textContent = data.message
        || 'Your information is securely with Shamrock. We will match the right people and case, then send final DocuSeal paperwork if it is needed.';
    showScreen('blocked');
}

function normalizeSignUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) return '';
    if (url.startsWith('/s/') || url.startsWith('s/')) {
        return SIGN_HOST + (url.startsWith('/') ? url : '/' + url);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return '';
}

function openSigning() {
    const url = normalizeSignUrl(state.packet && state.packet.signing_link);
    if (!url) {
        showScreen('blocked');
        return;
    }
    showScreen('sign');
    const mount = document.getElementById('docuseal-mount');
    mount.innerHTML = '';
    const form = document.createElement('docuseal-form');
    const attrs = {
        'data-src': url,
        'data-host': SIGN_EMBED_HOST,
        'data-expand': 'true',
        'data-minimize': 'false',
        'data-go-to-last': 'true',
        'data-autoscroll-fields': 'true',
        'data-order-as-on-page': 'true',
        'data-only-required-fields': 'true',
        'data-with-complete-button': 'true',
        'data-with-title': 'false',
        'data-with-field-names': 'false',
        'data-with-field-placeholder': 'true',
        'data-remember-signature': 'true',
        'data-reuse-signature': 'true',
        'data-send-copy-email': 'false',
        'data-allow-typed-signature': 'true',
        'data-completed-message-title': 'You are done',
        'data-completed-message-body': 'Thank you. Shamrock has your signature. Call (239) 332-2245 if you need anything else.',
        'data-custom-css': '.submit-form-button,.expand-form-button,.start-form-submit-button,.completed-form-completed-button{background-color:#16a34a;border:0;border-radius:12px;color:#052e16;min-height:48px;font-weight:700}.draw-canvas{border-radius:12px;min-height:140px;background:#fff}.field-area-active{border-color:#16a34a}.field-area-active-label{background-color:#16a34a;color:#052e16}',
        'data-i18n': '{"submit":"Continue","complete":"Finish signing","next":"Next","type":"Type name","draw":"Draw signature"}',
    };
    if (state.role) attrs['data-role'] = state.role;
    Object.keys(attrs).forEach((key) => form.setAttribute(key, attrs[key]));
    form.id = 'embeddedDocuSeal';
    form.addEventListener('completed', onSigned);
    mount.appendChild(form);
}

function onSigned() {
    showScreen('done');
    notifyParent({ type: 'shamrock-paperwork-complete' });
}

function notifyParent(msg) {
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(msg, '*');
        }
    } catch (e) { /* ignore */ }
}
