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
    maybeEnableScan();
}

function maybeEnableScan() {
    document.getElementById('scanIdBtn').disabled = !state.idFile;
}

async function scanId() {
    if (!state.idFile) return;
    setStatus('identityStatus', 'Scanning ID…');
    const form = new FormData();
    form.set('session_token', state.sessionToken);
    form.set('file', state.idFile, state.idFile.name || 'id.jpg');
    const data = await api('id-ocr', {}, { form });
    if (!data.success || !data.extracted) {
        setStatus('identityStatus', data.error || 'Could not read that ID. Try a clearer photo.', 'error');
        return;
    }
    state.extracted = data.extracted;
    fillFromExtracted(data.extracted);
    const preview = document.getElementById('idPreview');
    preview.classList.remove('hidden');
    preview.textContent = [data.extracted.full_name, data.extracted.dob, data.extracted.dl_number].filter(Boolean).join(' · ');
    setStatus('identityStatus', 'ID read. Review the address and your role-specific details.', 'ok');
    openPopup('address');
}

function fillFromExtracted(ext) {
    document.getElementById('addrStreet').value = ext.address || '';
    document.getElementById('addrCity').value = ext.city || '';
    document.getElementById('addrState').value = ext.state || '';
    document.getElementById('addrZip').value = ext.zip || '';
    document.getElementById('fieldName').value = ext.full_name || document.getElementById('fieldName').value;
    const defDl = document.getElementById('fieldDefendantDl');
    if (state.role === 'defendant') {
        if (defDl) defDl.value = ext.dl_number || defDl.value;
    } else {
        document.getElementById('fieldDl').value = ext.dl_number || document.getElementById('fieldDl').value;
    }
}

function confirmAddress() {
    closePopup('address');
    showScreen('ready');
    openPopup('fields');
}

function collectFields() {
    if (state.role === 'defendant') {
        return {
            defendant_name: val('fieldName'),
            defendant_address: val('addrStreet'),
            defendant_city: val('addrCity'),
            defendant_state: val('addrState'),
            defendant_zip: val('addrZip'),
            defendant_dl: val('fieldDefendantDl') || val('fieldDl'),
            defendant_dob: state.extracted.dob || '',
        };
    }
    const ref = document.getElementById('fieldRef1').value.trim();
    const [refName, refPhone] = splitRef(ref);
    return {
        indemnitor_name: val('fieldName'),
        IndemnitorName: val('fieldName'),
        FullName: val('fieldName'),
        indemnitor_address: val('addrStreet'),
        indemnitor_city: val('addrCity'),
        indemnitor_state: val('addrState'),
        indemnitor_zip: val('addrZip'),
        indemnitor_dl: val('fieldDl'),
        indemnitor_dob: state.extracted.dob || '',
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
