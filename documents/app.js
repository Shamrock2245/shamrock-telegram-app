/**
 * Shamrock Bail Bonds — Document Review & Sign
 * app.js
 *
 * Case lookup, document packet rendering, signing flow,
 * and supporting document uploads.
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycby5N-lHvM2XzKnX38KSqekq0ENWMLYqYM2bYxuZcRRAQcBhP3RvBaF0CbQa9gKK73QI4w/exec';

/**
 * Master document packet definition.
 * Order matches Dashboard.html CONFIG.templateOrder.
 * Each doc has: id, title, icon (Phosphor), description, signers, and type.
 */
const PACKET_DOCS = [
    {
        id: 'paperwork-header',
        title: 'Paperwork Header',
        icon: 'ph-file-text',
        description: 'Cover page with defendant name, indemnitor name(s), and case number(s).',
        signers: [],
        type: 'readonly',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'faq-cosigners',
        title: 'FAQ — Cosigners',
        icon: 'ph-question',
        description: 'Frequently asked questions about co-signer obligations and responsibilities.',
        signers: ['Indemnitor initials', 'Defendant initials'],
        type: 'initial-all',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'faq-defendants',
        title: 'FAQ — Defendants',
        icon: 'ph-question',
        description: 'Frequently asked questions about defendant responsibilities and court obligations.',
        signers: ['Indemnitor initials', 'Defendant initials'],
        type: 'initial-all',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'indemnity-agreement',
        title: 'Indemnity Agreement',
        icon: 'ph-shield-check',
        description: 'Core agreement establishing the indemnitor\'s financial responsibility for the bond.',
        signers: ['Indemnitor signature'],
        type: 'sign',
        roles: ['indemnitor']
    },
    {
        id: 'defendant-application',
        title: 'Defendant Application',
        icon: 'ph-identification-card',
        description: 'Application for appearance bond — completed by the defendant upon release.',
        signers: ['Defendant signature'],
        type: 'defendant-only',
        roles: ['defendant']
    },
    {
        id: 'promissory-note',
        title: 'Promissory Note',
        icon: 'ph-hand-coins',
        description: 'Promise to pay the full bond amount if conditions are violated.',
        signers: ['Indemnitor signature', 'Defendant signature'],
        type: 'sign',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'disclosure-form',
        title: 'Disclosure Form',
        icon: 'ph-info',
        description: 'Required legal disclosures about the bail bond transaction.',
        signers: ['Indemnitor signature', 'Defendant signature', 'Agent signature'],
        type: 'sign',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'surety-terms',
        title: 'Surety Terms & Conditions',
        icon: 'ph-scales',
        description: 'Terms and conditions governing the surety bail bond agreement.',
        signers: ['Indemnitor signature', 'Defendant signature'],
        type: 'sign',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'master-waiver',
        title: 'Master Waiver',
        icon: 'ph-scroll',
        description: '4-page waiver with initials on each page and final signatures.',
        signers: ['Indemnitor initials + signature', 'Defendant initials + signature', 'Agent signature'],
        type: 'sign',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'ssa-release',
        title: 'SSA Release',
        icon: 'ph-fingerprint',
        description: 'Social Security Authorization release — one copy per person on the bond.',
        signers: ['Per-person signature'],
        type: 'sign-per-person',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'collateral-receipt',
        title: 'Premium & Collateral Receipt',
        icon: 'ph-receipt',
        description: 'Auto-generated upon payment. Serial numbers must match appearance bonds.',
        signers: ['Indemnitor signature', 'Agent signature'],
        type: 'pending-payment',
        roles: ['indemnitor']
    },
    {
        id: 'payment-plan',
        title: 'Payment Plan',
        icon: 'ph-calendar-check',
        description: 'Payment schedule for remaining balance. Only required if balance > $0.',
        signers: ['Indemnitor signature', 'Defendant signature'],
        type: 'conditional',
        roles: ['indemnitor', 'defendant']
    },
    {
        id: 'appearance-bonds',
        title: 'Appearance Bonds',
        icon: 'ph-gavel',
        description: 'One per charge — print only, signed by agent with wet signature. Not sent to SignNow.',
        signers: ['Agent (wet signature)'],
        type: 'print-only',
        roles: []
    }
];

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let currentCase = null;
let uploadedFiles = [];

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTelegram();
    initPhoneFormatting();
    initFileUpload();

    // Allow Enter key on inputs
    document.getElementById('caseNumberInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') lookupDocuments();
    });
    document.getElementById('phoneInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') lookupDocuments();
    });
});

function initPhoneFormatting() {
    const phoneInput = document.getElementById('phoneInput');
    phoneInput.addEventListener('input', () => {
        phoneInput.value = formatPhone(phoneInput.value);
    });
}

function initFileUpload() {
    const fileInput = document.getElementById('supportFile');
    fileInput.addEventListener('change', handleSupportingFiles);
}

// ═══════════════════════════════════════════════════════════════
// CASE LOOKUP
// ═══════════════════════════════════════════════════════════════

async function lookupDocuments() {
    const caseNumber = document.getElementById('caseNumberInput').value.trim();
    const phone = document.getElementById('phoneInput').value.replace(/\D/g, '');
    const errorEl = document.getElementById('lookupError');
    const loaderEl = document.getElementById('lookupLoader');
    const btnText = document.querySelector('#lookupBtn .btn-text');

    errorEl.classList.add('hidden');

    if (!caseNumber && phone.length < 10) {
        errorEl.textContent = 'Please enter a case number or 10-digit phone number.';
        errorEl.classList.remove('hidden');
        return;
    }

    // Show loading
    btnText.classList.add('hidden');
    loaderEl.classList.remove('hidden');

    try {
        const params = new URLSearchParams({
            action: 'telegram_document_lookup',
            ...(caseNumber ? { caseNumber } : { phone })
        });

        const response = await fetch(`${GAS_ENDPOINT}?${params}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Case not found. Check your case number and try again.');
        }

        currentCase = data;
        renderPacket(data);

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        btnText.classList.remove('hidden');
        loaderEl.classList.add('hidden');
    }
}

// ═══════════════════════════════════════════════════════════════
// RENDER PACKET
// ═══════════════════════════════════════════════════════════════

function renderPacket(caseData) {
    // Hide lookup, show packet
    document.getElementById('lookupScreen').classList.add('hidden');
    document.getElementById('packetScreen').classList.remove('hidden');

    // Populate case header
    document.getElementById('caseDisplay').textContent = caseData.caseNumber || '—';
    document.getElementById('defendantName').textContent = caseData.defendantName || '—';
    document.getElementById('indemnitorName').textContent = caseData.indemnitorName || '—';

    // Build document list
    const docList = document.getElementById('docList');
    docList.innerHTML = '';

    const role = 'indemnitor'; // This app is the indemnitor view
    let totalDocs = 0;
    let signedDocs = 0;

    PACKET_DOCS.forEach((doc, index) => {
        const status = getDocStatus(doc, caseData, role);
        const card = createDocCard(doc, index + 1, status);
        docList.appendChild(card);

        if (status.actionable) {
            totalDocs++;
            if (status.complete) signedDocs++;
        }
    });

    updateProgress(signedDocs, totalDocs);
}

function getDocStatus(doc, caseData, role) {
    // Check if this doc is relevant to the current role's view
    const isForRole = doc.roles.includes(role);
    const docStatus = caseData.documentStatuses?.[doc.id] || {};

    if (doc.type === 'print-only') {
        return { label: 'Print Only', class: 'readonly', icon: 'ph-printer', actionable: false, complete: false };
    }

    if (doc.type === 'defendant-only' && role === 'indemnitor') {
        return { label: 'Defendant Signs', class: 'waiting', icon: 'ph-clock', actionable: false, complete: false };
    }

    if (doc.type === 'pending-payment' && !caseData.paymentReceived) {
        return { label: 'Pending Payment', class: 'waiting', icon: 'ph-clock', actionable: false, complete: false };
    }

    if (doc.type === 'conditional' && !(caseData.remainingBalance > 0)) {
        return { label: 'Not Required', class: 'readonly', icon: 'ph-minus-circle', actionable: false, complete: false };
    }

    if (doc.type === 'readonly') {
        return { label: 'Cover Page', class: 'readonly', icon: 'ph-eye', actionable: false, complete: false };
    }

    if (docStatus.signed) {
        return { label: 'Signed ✓', class: 'signed', icon: 'ph-check-circle', actionable: true, complete: true };
    }

    if (!isForRole) {
        return { label: 'View Only', class: 'readonly', icon: 'ph-eye', actionable: false, complete: false };
    }

    return { label: 'Sign Now', class: 'pending', icon: 'ph-pen', actionable: true, complete: false };
}

function createDocCard(doc, number, status) {
    const wrapper = document.createElement('div');

    // Main card
    const card = document.createElement('div');
    card.className = `doc-card ${status.class}`;
    card.onclick = () => toggleDocExpand(doc.id);

    card.innerHTML = `
        <div class="doc-num">${number}</div>
        <div class="doc-info">
            <div class="doc-title"><i class="${doc.icon}"></i> ${doc.title}</div>
            <div class="doc-desc">${doc.description}</div>
        </div>
        <span class="doc-status status-${status.class === 'pending' ? 'sign' : status.class}">
            ${status.label}
        </span>
    `;

    wrapper.appendChild(card);

    // Expanded detail
    const expanded = document.createElement('div');
    expanded.className = 'doc-expanded';
    expanded.id = `expand-${doc.id}`;

    let expandHTML = `<div class="doc-detail">${doc.description}</div>`;

    if (doc.signers.length > 0) {
        expandHTML += `<div class="signer-list">`;
        doc.signers.forEach(s => {
            expandHTML += `<span class="signer-tag"><i class="ph-user"></i> ${s}</span>`;
        });
        expandHTML += `</div>`;
    }

    if (status.class === 'pending') {
        expandHTML += `
            <button class="shamrock-btn shamrock-btn-primary sign-btn" onclick="openSigning('${doc.id}')">
                <i class="ph-pen"></i> Sign This Document
            </button>
        `;
    }

    expanded.innerHTML = expandHTML;
    wrapper.appendChild(expanded);

    return wrapper;
}

function toggleDocExpand(docId) {
    const el = document.getElementById(`expand-${docId}`);
    if (!el) return;

    const isActive = el.classList.contains('active');

    // Close all
    document.querySelectorAll('.doc-expanded.active').forEach(e => e.classList.remove('active'));

    // Toggle this one
    if (!isActive) el.classList.add('active');
}

function updateProgress(signed, total) {
    const pct = total > 0 ? Math.round((signed / total) * 100) : 0;
    document.getElementById('progressLabel').textContent = `${signed} of ${total} documents`;
    document.getElementById('progressPercent').textContent = `${pct}%`;
    document.getElementById('packetProgress').style.width = `${pct}%`;
}

// ═══════════════════════════════════════════════════════════════
// SIGNING
// ═══════════════════════════════════════════════════════════════

async function openSigning(docId) {
    if (!currentCase) return;

    try {
        const params = new URLSearchParams({
            action: 'telegram_get_signing_url',
            caseNumber: currentCase.caseNumber,
            documentId: docId
        });

        const response = await fetch(`${GAS_ENDPOINT}?${params}`);
        const data = await response.json();

        if (data.signingUrl) {
            // Open SignNow embedded signing
            window.open(data.signingUrl, '_blank');
        } else {
            alert('Signing link not available yet. Your agent is preparing your documents.');
        }
    } catch (err) {
        alert('Unable to load signing link. Please try again or call (239) 332-2245.');
    }
}

// ═══════════════════════════════════════════════════════════════
// SUPPORTING DOCUMENT UPLOADS
// ═══════════════════════════════════════════════════════════════

async function handleSupportingFiles(e) {
    const files = e.target.files;
    if (!files.length) return;

    const uploadList = document.getElementById('uploadList');

    for (const file of files) {
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.innerHTML = `
            <i class="ph-file"></i>
            <span class="file-name">${file.name}</span>
            <span class="file-status">Uploading…</span>
        `;
        uploadList.appendChild(item);

        try {
            await uploadFile(file);
            item.querySelector('.file-status').textContent = 'Uploaded ✓';
            uploadedFiles.push(file.name);
        } catch (err) {
            item.querySelector('.file-status').textContent = 'Failed';
            item.querySelector('.file-status').style.color = '#EF4444';
        }
    }

    // Reset input for next upload
    e.target.value = '';
}

async function uploadFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const base64 = ev.target.result.split(',')[1];
                const response = await fetch(GAS_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'telegram_mini_app_upload',
                        caseNumber: currentCase?.caseNumber || 'unknown',
                        fileName: file.name,
                        mimeType: file.type,
                        base64Data: base64,
                        uploadType: 'supporting_document'
                    })
                });
                const data = await response.json();
                if (data.success) resolve(data);
                else reject(new Error(data.error));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function formatPhone(value) {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
