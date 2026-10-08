/**
 * Canonical ShamrockLeads intake submit.
 *
 * POST {LEADS}/api/intake/submit with X-API-Key (GAS_API_KEY, else
 * LEADS_INTERNAL_TOKEN). The browser never sees the key.
 *
 * Field order: an ID scan, when one exists, seeds identity. A stated name,
 * address, phone, and the best real email then fill or replace those fields.
 * Bond amounts and booking numbers are included only when the person gave a
 * real one. Surety is left unset.
 */

const DEFAULT_LEADS_BASE = 'https://leads.shamrockbailbonds.biz';
const OFFICE_EMAIL = 'admin@shamrockbailbonds.biz';
// A scan and a submit run in series. 3.5s each keeps the function near 7s,
// under Netlify's 10s limit. The browser, not this function, calls GAS.
export const DEFAULT_TIMEOUT_MS = 3500;

function requestTimeout(timeoutMs) {
    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return {
        signal: controller.signal,
        clear() { clearTimeout(timer); },
    };
}

export function leadsBaseUrl(env = process.env) {
    return String(
        env.SHANNON_LEADS_URL || env.LEADS_API_URL || env.CRM_API_URL || DEFAULT_LEADS_BASE
    ).replace(/\/$/, '');
}

export function machineKey(env = process.env) {
    return String(env.GAS_API_KEY || env.LEADS_INTERNAL_TOKEN || '').trim();
}

export function cleanText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

export function isRealEmail(value) {
    const email = cleanText(value).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
    if (email === OFFICE_EMAIL) return '';
    if (/^admin\+[^@]*@shamrockbailbonds\.biz$/.test(email)) return '';
    return email;
}

/** First real email in priority order. Never invents one. */
export function bestEmail(candidates) {
    for (const candidate of candidates || []) {
        const email = isRealEmail(candidate);
        if (email) return email;
    }
    return '';
}

/**
 * A bond the person actually stated. Blank, zero, and placeholders are omitted
 * so the CRM does not store an invented amount.
 */
export function statedBondAmount(value) {
    const raw = cleanText(value).replace(/[$,\s]/g, '');
    if (!raw) return '';
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return '';
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return String(amount);
}

/** A booking key the person gave. Generated case refs and call SIDs are not bookings. */
export function statedBookingNumber(value, intakeId) {
    const raw = cleanText(value);
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (['unknown', 'tbd', 'n/a', 'na', 'none', 'skip'].includes(lower)) return '';
    if (intakeId && raw === cleanText(intakeId)) return '';
    if (/^sh-/i.test(raw) || /^tg-/i.test(raw)) return '';
    if (/^(CA|SM|MM|NO|PN)[0-9a-f]{32}$/i.test(raw)) return '';
    if (/^(conv_|tlcal_)/i.test(raw)) return '';
    return raw;
}

/** Drop a Telegram chat id that was stored in the phone field. */
export function statedPhone(value, telegramUserId) {
    const digits = cleanText(value).replace(/\D/g, '');
    if (!digits) return '';
    const chat = cleanText(telegramUserId).replace(/\D/g, '');
    if (chat && digits === chat) return '';
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    if (digits.length !== 10) return '';
    if (digits === '7272952245' || digits === '2393322245' || digits === '2399550178') return '';
    return digits;
}

function splitName(full) {
    const parts = cleanText(full).split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
}

function callerRole(form) {
    const role = cleanText(form.caller_role || form.role || form.signer_role).toLowerCase();
    return role === 'defendant' ? 'defendant' : 'indemnitor';
}

function put(target, key, value) {
    const text = cleanText(value);
    if (text) target[key] = text;
}

/**
 * @param {'telegram'|'telegram_miniapp'|'shannon_voice'} source
 * @param {{ form?: object, said?: object, scan?: object, ocr?: object, intakeId?: string }} input
 */
export function buildCrmIntakeBody(source, input = {}) {
    const form = input.form || input.said || {};
    const scan = input.scan || {};
    const ocr = input.ocr || {};
    const role = callerRole(form);
    const scanOnDefendant = role === 'defendant';
    const chatId = cleanText(form.telegramUserId || form.telegram_user_id);

    const scanName = cleanText(scan.full_name);
    const scanAddress = cleanText(scan.address);
    const scanCity = cleanText(scan.city);
    const scanState = cleanText(scan.state || scan.dl_state);
    const scanZip = cleanText(scan.zip);
    const scanDob = cleanText(scan.dob);
    const scanDl = cleanText(scan.dl_number || scan.dl);
    const scanDlState = cleanText(scan.dl_state || scan.state);

    let indName = scanOnDefendant ? '' : (scanName || cleanText(ocr.indemnitor_name || ocr.IndName || ocr.FullName));
    let indAddress = scanOnDefendant ? '' : (scanAddress || cleanText(ocr.indemnitor_address));
    let indCity = scanOnDefendant ? '' : (scanCity || cleanText(ocr.indemnitor_city));
    let indState = scanOnDefendant ? '' : (scanState || cleanText(ocr.indemnitor_state));
    let indZip = scanOnDefendant ? '' : (scanZip || cleanText(ocr.indemnitor_zip));
    let indDob = scanOnDefendant ? '' : (scanDob || cleanText(ocr.indemnitor_dob));
    let indDl = scanOnDefendant ? '' : (scanDl || cleanText(ocr.indemnitor_dl));

    let defName = scanOnDefendant
        ? (scanName || cleanText(ocr.defendant_name || ocr.DefName))
        : cleanText(ocr.defendant_name || ocr.DefName);
    let defAddress = scanOnDefendant ? (scanAddress || cleanText(ocr.defendant_address)) : cleanText(ocr.defendant_address);
    let defCity = scanOnDefendant ? (scanCity || cleanText(ocr.defendant_city)) : cleanText(ocr.defendant_city);
    let defState = scanOnDefendant ? (scanState || cleanText(ocr.defendant_state)) : cleanText(ocr.defendant_state);
    let defZip = scanOnDefendant ? (scanZip || cleanText(ocr.defendant_zip)) : cleanText(ocr.defendant_zip);
    let defDob = scanOnDefendant ? (scanDob || cleanText(ocr.defendant_dob)) : cleanText(ocr.defendant_dob || ocr.DefDOB);
    let defDl = scanOnDefendant ? (scanDl || cleanText(ocr.defendant_dl)) : cleanText(ocr.defendant_dl);

    const saidIndName = cleanText(
        form.IndName || form.indemnitorName || form.indemnitor_name || form.IndemnitorName
        || (role === 'indemnitor' ? (form.caller_name || form.callerName) : '')
    );
    const saidDefName = cleanText(
        form.DefName || form.defendantName || form.defendant_name
        || (role === 'defendant' ? (form.caller_name || form.callerName) : '')
    );
    const saidIndAddress = cleanText(form.IndAddress || form.indemnitorAddress || form.indemnitor_address || form.address);
    const saidDefAddress = cleanText(form.DefAddress || form.defendant_address || form.defendantAddress);
    if (saidIndName) indName = saidIndName;
    if (saidDefName) defName = saidDefName;
    if (saidIndAddress) indAddress = saidIndAddress;
    if (saidDefAddress) defAddress = saidDefAddress;

    const saidIndCity = cleanText(form.IndCity || form.indemnitor_city || form.indemnitorCity);
    const saidIndState = cleanText(form.IndState || form.indemnitor_state || form.indemnitorState);
    const saidIndZip = cleanText(form.IndZip || form.indemnitor_zip || form.indemnitorZip);
    const saidDefCity = cleanText(form.DefCity || form.defendant_city);
    const saidDefState = cleanText(form.DefState || form.defendant_state);
    const saidDefZip = cleanText(form.DefZip || form.defendant_zip);
    if (saidIndCity) indCity = saidIndCity;
    if (saidIndState) indState = saidIndState;
    if (saidIndZip) indZip = saidIndZip;
    if (saidDefCity) defCity = saidDefCity;
    if (saidDefState) defState = saidDefState;
    if (saidDefZip) defZip = saidDefZip;

    const saidIndDob = cleanText(form.IndDOB || form.indemnitorDOB || form.indemnitor_dob);
    const saidDefDob = cleanText(form.DefDOB || form.defendantDOB || form.defendant_dob);
    const saidIndDl = cleanText(form.IndDL || form.indemnitor_dl || form.indemnitorDL);
    const saidDefDl = cleanText(form.DefDL || form.defendant_dl || form.defendantDL);
    if (saidIndDob) indDob = saidIndDob;
    if (saidDefDob) defDob = saidDefDob;
    if (saidIndDl) indDl = saidIndDl;
    if (saidDefDl) defDl = saidDefDl;

    const indPhone = statedPhone(
        form.IndPhone || form.indemnitorPhone || form.indemnitor_phone
        || (role === 'indemnitor' ? (form.caller_phone || form.callerPhone || form.phone) : ''),
        chatId
    );
    const defPhone = statedPhone(
        form.DefPhone || form.defendantPhone || form.defendant_phone
        || (role === 'defendant' ? (form.caller_phone || form.callerPhone || form.phone) : ''),
        chatId
    );
    const email = bestEmail([
        form.IndEmail,
        form.indemnitorEmail,
        form.indemnitor_email,
        form.caller_email,
        form.email,
        form.DefEmail,
        form.defendantEmail,
        form.defendant_email,
    ]);

    const intakeId = cleanText(input.intakeId || form.intakeId || form.intake_id || form.case_reference || form.caseId);
    const indParts = splitName(indName);
    const defParts = splitName(defName);
    const body = { source };

    put(body, 'intakeId', intakeId);
    put(body, 'IndName', indName);
    put(body, 'indemnitorName', indName);
    put(body, 'IndFirstName', cleanText(form.IndFirstName) || indParts.first);
    put(body, 'IndLastName', cleanText(form.IndLastName) || indParts.last);
    put(body, 'IndAddress', indAddress);
    put(body, 'IndCity', indCity);
    put(body, 'IndState', indState);
    put(body, 'IndZip', indZip);
    put(body, 'IndDOB', indDob);
    put(body, 'IndDL', indDl);
    put(body, 'IndDLState', scanOnDefendant ? '' : scanDlState);
    put(body, 'IndPhone', indPhone);
    put(body, 'indemnitorPhone', indPhone);
    put(body, 'IndEmail', email);
    put(body, 'indemnitorEmail', email);
    put(body, 'IndRelation', form.IndRelation || form.indemnitor_relationship || form.relationship);
    put(body, 'IndEmployer', form.IndEmployer || form.indemnitor_employer);
    put(body, 'IndJobTitle', form.IndJobTitle);

    put(body, 'DefName', defName);
    put(body, 'defendantName', defName);
    put(body, 'DefFirstName', cleanText(form.DefFirstName) || defParts.first);
    put(body, 'DefLastName', cleanText(form.DefLastName) || defParts.last);
    put(body, 'DefAddress', defAddress);
    put(body, 'DefCity', defCity);
    put(body, 'DefState', defState);
    put(body, 'DefZip', defZip);
    put(body, 'DefDOB', defDob);
    put(body, 'DefDL', defDl);
    put(body, 'DefDLState', scanOnDefendant ? scanDlState : '');
    put(body, 'DefPhone', defPhone);
    put(body, 'defendantPhone', defPhone);
    put(body, 'DefFacility', form.DefFacility || form.facility);
    put(body, 'DefCounty', form.DefCounty || form.county);
    put(body, 'DefCharges', form.DefCharges || form.charges);

    const bond = statedBondAmount(form.DefBondAmount || form.bondAmount || form.bond_amount);
    if (bond) {
        body.DefBondAmount = bond;
        body.bondAmount = bond;
    }
    const booking = statedBookingNumber(
        form.bookingNumber || form.booking_number || form.DefBookingNumber,
        intakeId
    );
    if (booking) body.bookingNumber = booking;

    put(body, 'Ref1Name', form.Ref1Name);
    put(body, 'Ref1Phone', statedPhone(form.Ref1Phone, chatId));
    put(body, 'Ref1Relation', form.Ref1Relation);
    put(body, 'Ref2Name', form.Ref2Name);
    put(body, 'Ref2Phone', statedPhone(form.Ref2Phone, chatId));
    put(body, 'Ref2Relation', form.Ref2Relation);
    put(body, 'notes', form.notes);
    put(body, 'telegramUserId', chatId);
    put(body, 'telegramUsername', form.telegramUsername);
    if (form.gpsLatitude !== undefined && form.gpsLatitude !== null && form.gpsLatitude !== '') {
        body.gpsLatitude = form.gpsLatitude;
    }
    if (form.gpsLongitude !== undefined && form.gpsLongitude !== null && form.gpsLongitude !== '') {
        body.gpsLongitude = form.gpsLongitude;
    }
    if (form.manualLocation) body.manualLocation = form.manualLocation;
    if (form.consent || form.consentGiven) {
        body.consent = true;
        body.consentGiven = true;
        put(body, 'consentTimestamp', form.consentTimestamp);
    }
    return body;
}

export async function scanIdImage(imageB64, filename, options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const env = options.env || process.env;
    const key = machineKey(env);
    const b64 = cleanText(imageB64);
    if (!b64 || !key) return {};
    const timeout = requestTimeout(options.timeoutMs);
    try {
        const response = await fetchImpl(leadsBaseUrl(env) + '/api/id/scan-ocr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': key,
            },
            body: JSON.stringify({
                image_b64: b64,
                filename: cleanText(filename) || 'id.jpg',
            }),
            signal: timeout.signal,
        });
        if (!response.ok) {
            console.error('[crm-intake] ID scan failed status=' + response.status);
            return {};
        }
        const data = await response.json().catch(() => ({}));
        return (data && data.extracted && typeof data.extracted === 'object') ? data.extracted : {};
    } catch (err) {
        console.error('[crm-intake] ID scan failed error=' + (err && err.message));
        return {};
    } finally {
        timeout.clear();
    }
}

export async function submitCrmIntake(body, options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const env = options.env || process.env;
    const key = machineKey(env);
    const source = body && body.source ? body.source : 'unknown';
    if (!key) {
        console.error('[crm-intake] FAILED source=' + source + ' error=missing_GAS_API_KEY_or_LEADS_INTERNAL_TOKEN');
        return { ok: false, status: 0, error: 'missing_machine_key', source };
    }
    const timeout = requestTimeout(options.timeoutMs);
    let response;
    try {
        response = await fetchImpl(leadsBaseUrl(env) + '/api/intake/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': key,
            },
            body: JSON.stringify(body),
            signal: timeout.signal,
        });
    } catch (err) {
        const aborted = !!(err && (err.name === 'AbortError' || timeout.signal.aborted));
        const error = aborted ? 'timeout' : (err && err.message ? err.message : 'network');
        console.error('[crm-intake] FAILED source=' + source + ' error=' + error);
        return { ok: false, status: 0, error, source };
    } finally {
        timeout.clear();
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data || data.success !== true) {
        const error = (data && (data.error || data.message)) || ('http_' + response.status);
        console.error('[crm-intake] FAILED source=' + source + ' status=' + response.status + ' error=' + error);
        return { ok: false, status: response.status, error, source, body: data };
    }
    return {
        ok: true,
        status: response.status,
        source: data.source || source,
        intake_id: data.intake_id || body.intakeId || '',
        body: data,
    };
}
