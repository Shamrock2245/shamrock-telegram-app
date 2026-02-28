/**
 * Shamrock Bail Bonds — Defendant Portal
 * app.js
 *
 * Case lookup, document signing, ID upload, GPS check-in,
 * payment info, and info updates.
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycby5EM_U4d1GRHf_Or64RPGlOFUuOFld4m5ap9DghRm5njoUCTzSmEVmzmwmak9sR6fSFQ/exec';
const PAYMENT_LINK = 'https://swipesimple.com/links/lnk_07a13eb404d7f3057a56d56d8bb488c8';

/** Documents the defendant needs to sign (subset of full packet) */
const DEFENDANT_DOCS = [
    { id: 'faq-cosigners', title: 'FAQ — Cosigners', icon: 'ph-question', desc: 'Initial each page to confirm you understand co-signer obligations.' },
    { id: 'faq-defendants', title: 'FAQ — Defendants', icon: 'ph-question', desc: 'Initial each page to confirm you understand your responsibilities.' },
    { id: 'defendant-application', title: 'Defendant Application', icon: 'ph-identification-card', desc: 'Your personal application for the appearance bond.' },
    { id: 'promissory-note', title: 'Promissory Note', icon: 'ph-hand-coins', desc: 'Promise to pay the full bond amount if conditions are violated.' },
    { id: 'disclosure-form', title: 'Disclosure Form', icon: 'ph-info', desc: 'Required legal disclosures about the bail bond transaction.' },
    { id: 'surety-terms', title: 'Surety Terms & Conditions', icon: 'ph-scales', desc: 'Terms governing the surety bail bond agreement.' },
    { id: 'master-waiver', title: 'Master Waiver', icon: 'ph-scroll', desc: 'Initial each page and sign the final page.' },
    { id: 'ssa-release', title: 'SSA Release', icon: 'ph-fingerprint', desc: 'Social Security Authorization release — your personal copy.' },
    { id: 'payment-plan', title: 'Payment Plan', icon: 'ph-calendar-check', desc: 'Payment schedule — only if there\'s a remaining balance.' }
];

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let currentCase = null;
let gpsData = { lat: null, lng: null };

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTelegram();
    initPhoneFormat();
    initFilePreview();

    // Enter key support
    document.getElementById('caseInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') lookupCase();
    });
    document.getElementById('phoneInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') lookupCase();
    });
});

function initPhoneFormat() {
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) {
        phoneInput.addEventListener('input', () => {
            phoneInput.value = formatPhone(phoneInput.value);
        });
    }
}

function initFilePreview() {
    // ID front
    setupFilePreview('idFront', 'idFrontPreview', 'idFrontUpload');
    // ID back
    setupFilePreview('idBack', 'idBackPreview', 'idBackUpload');
    // Selfie
    setupFilePreview('selfie', 'selfiePreview', null);
    // Supporting docs
    const supportInput = document.getElementById('supportDocs');
    if (supportInput) {
        supportInput.addEventListener('change', handleDefSupportDocs);
    }
}

function setupFilePreview(inputId, previewId, uploadId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const preview = document.getElementById(previewId);
            if (preview) {
                preview.innerHTML = `<img src="${ev.target.result}" alt="Preview">`;
                preview.classList.remove('hidden');
            }
            if (uploadId) {
                const upload = document.getElementById(uploadId);
                if (upload) upload.querySelector('.file-upload-content')?.classList.add('hidden');
            }
        };
        reader.readAsDataURL(file);
    });
}

// ═══════════════════════════════════════════════════════════════
// CASE LOOKUP
// ═══════════════════════════════════════════════════════════════

async function lookupCase() {
    const caseNum = document.getElementById('caseInput').value.trim();
    const phone = document.getElementById('phoneInput').value.replace(/\D/g, '');
    const errorEl = document.getElementById('lookupError');
    const loader = document.getElementById('lookupLoader');
    const btnText = document.querySelector('#lookupBtn .btn-text');

    errorEl.classList.add('hidden');

    if (!caseNum && phone.length < 10) {
        errorEl.textContent = 'Please enter a case number or 10-digit phone number.';
        errorEl.classList.remove('hidden');
        return;
    }

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');

    try {
        const params = new URLSearchParams({
            action: 'telegram_defendant_lookup',
            ...(caseNum ? { caseNumber: caseNum } : { phone })
        });

        const response = await fetch(`${GAS_ENDPOINT}?${params}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Case not found. Check your case number and try again.');
        }

        currentCase = data;
        renderPortal(data);

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
    }
}

// ═══════════════════════════════════════════════════════════════
// RENDER PORTAL
// ═══════════════════════════════════════════════════════════════

function renderPortal(caseData) {
    document.getElementById('lookupScreen').classList.add('hidden');
    document.getElementById('portalScreen').classList.remove('hidden');

    // Case banner
    document.getElementById('portalDefName').textContent = caseData.defendantName || 'Defendant';
    document.getElementById('portalCaseNum').textContent = caseData.caseNumber || '—';
    document.getElementById('portalStatus').textContent = caseData.bondStatus || 'Active';

    // Render defendant docs
    renderDefendantDocs(caseData);

    // Payment info
    document.getElementById('payBondAmount').textContent = caseData.bondAmount ? `$${Number(caseData.bondAmount).toLocaleString()}` : '—';
    document.getElementById('payPremium').textContent = caseData.premium ? `$${Number(caseData.premium).toLocaleString()}` : '—';
    document.getElementById('payBalance').textContent = caseData.remainingBalance ? `$${Number(caseData.remainingBalance).toLocaleString()}` : '$0';
}

function renderDefendantDocs(caseData) {
    const list = document.getElementById('defDocList');
    list.innerHTML = '';

    let total = 0;
    let signed = 0;

    DEFENDANT_DOCS.forEach(doc => {
        // Skip payment plan if no balance
        if (doc.id === 'payment-plan' && !(caseData.remainingBalance > 0)) return;

        const docStatus = caseData.documentStatuses?.[doc.id] || {};
        const isSigned = docStatus.signed || false;

        if (isSigned) signed++;
        total++;

        const card = document.createElement('div');
        card.className = `doc-card ${isSigned ? 'signed' : 'pending'}`;
        card.onclick = () => {
            if (!isSigned) openDefendantSigning(doc.id);
        };

        card.innerHTML = `
            <div class="doc-icon"><i class="ph ${doc.icon}"></i></div>
            <div class="doc-info">
                <div class="doc-title">${doc.title}</div>
                <div class="doc-desc">${doc.desc}</div>
            </div>
            <span class="doc-status ${isSigned ? 'status-signed' : 'status-sign'}">
                ${isSigned ? 'Signed ✓' : 'Sign Now'}
            </span>
        `;

        list.appendChild(card);
    });

    // Update progress
    const pct = total > 0 ? Math.round((signed / total) * 100) : 0;
    document.getElementById('defDocProgress').textContent = `${signed} of ${total} signed`;
    document.getElementById('defProgressBar').style.width = `${pct}%`;
}

// ═══════════════════════════════════════════════════════════════
// SIGNING
// ═══════════════════════════════════════════════════════════════

async function openDefendantSigning(docId) {
    if (!currentCase) return;
    try {
        const params = new URLSearchParams({
            action: 'telegram_get_signing_url',
            caseNumber: currentCase.caseNumber,
            documentId: docId,
            role: 'defendant'
        });
        const response = await fetch(`${GAS_ENDPOINT}?${params}`);
        const data = await response.json();
        if (data.signingUrl) {
            window.open(data.signingUrl, '_blank');
        } else {
            alert('Signing link not available yet. Your bondsman is preparing your documents.');
        }
    } catch (err) {
        alert('Unable to load signing link. Please call (239) 332-2245.');
    }
}

// ═══════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════

function switchTab(tabId) {
    // Deactivate all tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Activate selected
    document.querySelector(`.tab[data-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabId}`)?.classList.add('active');

    // Haptic feedback
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
}

// ═══════════════════════════════════════════════════════════════
// ID UPLOAD
// ═══════════════════════════════════════════════════════════════

async function uploadDefendantId() {
    const frontFile = document.getElementById('idFront').files[0];
    const backFile = document.getElementById('idBack').files[0];
    const resultEl = document.getElementById('uploadResult');
    const loader = document.getElementById('uploadLoader');
    const btnText = document.querySelector('#uploadIdBtn .btn-text');

    if (!frontFile) {
        alert('Please upload the front of your ID.');
        return;
    }

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');

    try {
        // Upload front
        await uploadFileToGAS(frontFile, 'id_front');

        // Upload back if provided
        if (backFile) {
            await uploadFileToGAS(backFile, 'id_back');
        }

        resultEl.className = 'upload-result success';
        resultEl.innerHTML = '<i class="ph ph-check-circle"></i> ID uploaded successfully!';
        resultEl.classList.remove('hidden');
    } catch (err) {
        resultEl.className = 'upload-result';
        resultEl.style.background = 'rgba(239,68,68,0.1)';
        resultEl.style.color = '#EF4444';
        resultEl.innerHTML = `<i class="ph ph-warning"></i> Upload failed: ${err.message}`;
        resultEl.classList.remove('hidden');
    } finally {
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
    }
}

async function handleDefSupportDocs(e) {
    const files = e.target.files;
    if (!files.length) return;
    const list = document.getElementById('defUploadList');

    for (const file of files) {
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.innerHTML = `
            <i class="ph ph-file"></i>
            <span class="file-name">${file.name}</span>
            <span class="file-status">Uploading…</span>
        `;
        list.appendChild(item);

        try {
            await uploadFileToGAS(file, 'supporting_document');
            item.querySelector('.file-status').textContent = 'Uploaded ✓';
        } catch (err) {
            item.querySelector('.file-status').textContent = 'Failed';
            item.querySelector('.file-status').style.color = '#EF4444';
        }
    }
    e.target.value = '';
}

async function uploadFileToGAS(file, uploadType) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const base64 = ev.target.result.split(',')[1];
                const res = await fetch(GAS_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'telegram_mini_app_upload',
                        caseNumber: currentCase?.caseNumber || 'unknown',
                        fileName: file.name,
                        mimeType: file.type,
                        base64Data: base64,
                        uploadType,
                        role: 'defendant'
                    })
                });
                const data = await res.json();
                if (data.success) resolve(data);
                else reject(new Error(data.error || 'Upload failed'));
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

// ═══════════════════════════════════════════════════════════════
// GPS CHECK-IN
// ═══════════════════════════════════════════════════════════════

function captureGPS() {
    const btn = document.getElementById('gpsBtn');
    btn.innerHTML = '<span class="shamrock-spinner"></span> Getting location…';
    btn.disabled = true;
    captureLocationTiered({
        onSuccess: (lat, lng, source) => {
            setGPS(lat, lng);
            console.log('[location] Captured via', source);
        },
        onManualFallback: () => {
            resetGPSBtn('Location unavailable — tap to retry');
        },
        onStatusUpdate: (msg) => {
            btn.innerHTML = '<span class="shamrock-spinner"></span> ' + msg;
        }
    });
}
function setGPS(lat, lng) {
    gpsData = { lat, lng };
    document.getElementById('gpsResult').classList.remove('hidden');
    document.getElementById('gpsDisplay').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const btn = document.getElementById('gpsBtn');
    btn.innerHTML = '<i class="ph ph-check-circle"></i> Location Captured';
    btn.disabled = true;
    btn.classList.remove('shamrock-btn-outline');
    btn.classList.add('shamrock-btn-primary');
}

function resetGPSBtn(msg) {
    const btn = document.getElementById('gpsBtn');
    btn.innerHTML = `<i class="ph ph-warning"></i> ${msg}`;
    btn.disabled = false;
}

async function submitCheckin() {
    const selfieFile = document.getElementById('selfie').files[0];
    const resultEl = document.getElementById('checkinResult');
    const loader = document.getElementById('checkinLoader');
    const btnText = document.querySelector('#checkinBtn .btn-text');

    if (!selfieFile) {
        alert('Please take a selfie first.');
        return;
    }
    if (!gpsData.lat) {
        alert('Please share your location first.');
        return;
    }

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');

    try {
        // Upload selfie
        const selfieBase64 = await readFileAsBase64(selfieFile);

        const res = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'telegram_checkin_log',
                caseNumber: currentCase?.caseNumber,
                phone: currentCase?.defendantPhone || '',
                name: currentCase?.defendantName || '',
                latitude: gpsData.lat,
                longitude: gpsData.lng,
                selfieBase64: selfieBase64,
                selfieFileName: selfieFile.name,
                selfieMimeType: selfieFile.type
            })
        });
        const data = await res.json();

        if (data.success) {
            resultEl.className = 'checkin-result success';
            resultEl.innerHTML = '<i class="ph ph-check-circle"></i> Check-in submitted successfully!';
        } else {
            throw new Error(data.error || 'Check-in failed');
        }
    } catch (err) {
        resultEl.className = 'checkin-result';
        resultEl.style.background = 'rgba(239,68,68,0.1)';
        resultEl.style.color = '#EF4444';
        resultEl.innerHTML = `<i class="ph ph-warning"></i> ${err.message}`;
    } finally {
        resultEl.classList.remove('hidden');
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
    }
}

// ═══════════════════════════════════════════════════════════════
// INFO UPDATES
// ═══════════════════════════════════════════════════════════════

async function submitUpdate() {
    const type = document.getElementById('updateType').value;
    const details = document.getElementById('updateDetails').value.trim();

    if (!type) {
        alert('Please select what changed.');
        return;
    }
    if (!details) {
        alert('Please provide details about your update.');
        return;
    }

    try {
        const res = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'telegram_client_update',
                caseNumber: currentCase?.caseNumber,
                phone: currentCase?.defendantPhone || '',
                name: currentCase?.defendantName || '',
                updateType: type,
                updateDetails: details,
                role: 'defendant'
            })
        });
        const data = await res.json();

        if (data.success) {
            alert('Update submitted! We\'ll review it shortly.');
            document.getElementById('updateDetails').value = '';
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (err) {
        alert(`Update failed: ${err.message}`);
    }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════



function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result.split(',')[1]);
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}
