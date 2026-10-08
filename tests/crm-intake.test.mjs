import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bestEmail,
    buildCrmIntakeBody,
    scanIdImage,
    statedBondAmount,
    statedBookingNumber,
    statedPhone,
    submitCrmIntake,
} from '../netlify/functions/shared/crm-intake.mjs';

const ENV = {
    GAS_API_KEY: 'test-gas-key',
    SHANNON_LEADS_URL: 'https://leads.example.test',
};

test('mini-app payload starts from the ID scan, then stated name, address, phone, and email', () => {
    const body = buildCrmIntakeBody('telegram_miniapp', {
        intakeId: 'TG-ABC',
        scan: {
            full_name: 'JANE Q PUBLIC',
            address: '1 LICENSE RD',
            city: 'FORT MYERS',
            state: 'FL',
            zip: '33901',
            dob: '1990-01-02',
            dl_number: 'P123',
            dl_state: 'FL',
        },
        form: {
            source: 'telegram_miniapp',
            IndName: 'Jane Public',
            IndAddress: '99 Typed St, Fort Myers, FL 33901',
            IndPhone: '(239) 555-0101',
            IndEmail: 'jane@example.com',
            DefName: 'Bob Public',
            DefBondAmount: '',
            bookingNumber: 'SH-2395550101-BOB',
            surety_id: 'osi',
            telegramUserId: '555',
        },
    });

    assert.equal(body.source, 'telegram_miniapp');
    assert.equal(body.intakeId, 'TG-ABC');
    assert.equal(body.IndName, 'Jane Public');
    assert.equal(body.IndAddress, '99 Typed St, Fort Myers, FL 33901');
    assert.equal(body.IndCity, 'FORT MYERS');
    assert.equal(body.IndDOB, '1990-01-02');
    assert.equal(body.IndDL, 'P123');
    assert.equal(body.IndPhone, '2395550101');
    assert.equal(body.IndEmail, 'jane@example.com');
    assert.equal(body.DefName, 'Bob Public');
    assert.equal(body.bondAmount, undefined);
    assert.equal(body.bookingNumber, undefined);
    assert.equal(body.surety_id, undefined);
    assert.equal(body.skip_match, undefined);
});

test('scan fills name and address when the person has not typed them', () => {
    const body = buildCrmIntakeBody('telegram_miniapp', {
        scan: { full_name: 'JANE PUBLIC', address: '1 LICENSE RD', city: 'CAPE CORAL' },
        form: { IndPhone: '2395550102', IndEmail: 'jane@example.com' },
    });
    assert.equal(body.IndName, 'JANE PUBLIC');
    assert.equal(body.IndFirstName, 'JANE');
    assert.equal(body.IndLastName, 'PUBLIC');
    assert.equal(body.IndAddress, '1 LICENSE RD');
    assert.equal(body.IndCity, 'CAPE CORAL');
});

test('telegram chat id is not sent as a phone, and office numbers are not', () => {
    assert.equal(statedPhone('123456789', '123456789'), '');
    assert.equal(statedPhone('239-332-2245', ''), '');
    assert.equal(statedPhone('727-295-2245', ''), '');
    assert.equal(statedPhone('239-955-0178', ''), '');
    const body = buildCrmIntakeBody('telegram', {
        form: {
            IndName: 'Amy Roe',
            IndPhone: '5551234567',
            telegramUserId: '5551234567',
            IndEmail: 'amy@example.com',
            DefName: 'Bob Roe',
        },
    });
    assert.equal(body.source, 'telegram');
    assert.equal(body.IndPhone, undefined);
    assert.equal(body.IndEmail, 'amy@example.com');
});

test('bond and booking stay off unless the person gave a real one', () => {
    assert.equal(statedBondAmount(''), '');
    assert.equal(statedBondAmount('0'), '');
    assert.equal(statedBondAmount('$0'), '');
    assert.equal(statedBondAmount('TBD'), '');
    assert.equal(statedBondAmount('$5,000'), '5000');
    assert.equal(statedBookingNumber('SH-239-BOB', 'SH-239-BOB'), '');
    assert.equal(statedBookingNumber('CA' + 'a'.repeat(32), ''), '');
    assert.equal(statedBookingNumber('2026-4401', 'TG-1'), '2026-4401');
    const body = buildCrmIntakeBody('shannon_voice', {
        intakeId: 'SH-2395550101-BOB',
        said: {
            caller_name: 'Amy Roe',
            caller_phone: '2395550101',
            defendant_name: 'Bob Roe',
            bond_amount: '0',
            booking_number: 'SH-2395550101-BOB',
            county: 'Lee',
        },
    });
    assert.equal(body.source, 'shannon_voice');
    assert.equal(body.bondAmount, undefined);
    assert.equal(body.bookingNumber, undefined);
    assert.equal(body.DefCounty, 'Lee');
    assert.equal(body.IndName, 'Amy Roe');
    assert.equal(body.DefName, 'Bob Roe');
});

test('Shannon ID OCR is the base, then the caller name, phone, and best email', () => {
    const body = buildCrmIntakeBody('shannon_voice', {
        intakeId: 'SH-1',
        ocr: {
            indemnitor_name: 'AMY R ROE',
            indemnitor_address: '10 SCAN AVE',
            indemnitor_city: 'NAPLES',
            indemnitor_dob: '1988-04-04',
        },
        said: {
            caller_role: 'indemnitor',
            caller_name: 'Amy Roe',
            caller_phone: '2395550199',
            indemnitor_email: 'not-an-email',
            caller_email: 'admin+shannon-def-sh1@shamrockbailbonds.biz',
            defendant_email: 'family@example.com',
            defendant_name: 'Bob Roe',
        },
    });
    assert.equal(body.IndName, 'Amy Roe');
    assert.equal(body.IndAddress, '10 SCAN AVE');
    assert.equal(body.IndCity, 'NAPLES');
    assert.equal(body.IndDOB, '1988-04-04');
    assert.equal(body.IndPhone, '2395550199');
    assert.equal(body.IndEmail, 'family@example.com');
    assert.equal(bestEmail(['admin@shamrockbailbonds.biz', 'real@example.com']), 'real@example.com');
});

test('a defendant ID scan does not overwrite the indemnitor', () => {
    const body = buildCrmIntakeBody('shannon_voice', {
        scan: { full_name: 'BOB ROE', address: 'JAIL LOBBY' },
        said: { caller_role: 'defendant', caller_name: 'Bob Roe', caller_phone: '2395550188', indemnitor_name: 'Amy Roe' },
    });
    assert.equal(body.DefName, 'Bob Roe');
    assert.equal(body.DefAddress, 'JAIL LOBBY');
    assert.equal(body.IndName, 'Amy Roe');
    assert.equal(body.IndAddress, undefined);
    assert.equal(body.DefPhone, '2395550188');
});

test('scan request never includes a booking number, and submit uses the machine key', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init: JSON.parse(init.body), key: init.headers['X-API-Key'] });
        if (String(url).includes('/api/id/scan-ocr')) {
            return {
                ok: true,
                json: async () => ({ success: true, extracted: { full_name: 'JANE PUBLIC', address: '1 LICENSE RD' } }),
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, intake_id: 'TG-ABC', source: 'telegram_miniapp' }),
        };
    };
    const scan = await scanIdImage('abc123', 'id.jpg', { fetchImpl, env: ENV });
    assert.equal(scan.full_name, 'JANE PUBLIC');
    assert.equal(calls[0].init.booking_number, undefined);
    assert.equal(calls[0].init.image_b64, 'abc123');
    assert.equal(calls[0].key, 'test-gas-key');

    const result = await submitCrmIntake(
        buildCrmIntakeBody('telegram_miniapp', { intakeId: 'TG-ABC', scan, form: { IndPhone: '2395550101' } }),
        { fetchImpl, env: ENV }
    );
    assert.equal(result.ok, true);
    assert.equal(result.intake_id, 'TG-ABC');
    assert.equal(calls[1].url, 'https://leads.example.test/api/intake/submit');
    assert.equal(calls[1].init.source, 'telegram_miniapp');
    assert.equal(calls[1].init.IndName, 'JANE PUBLIC');
    assert.equal(calls[1].key, 'test-gas-key');
});

test('a failed CRM call is logged and does not look like success', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const result = await submitCrmIntake(
            { source: 'shannon_voice', IndName: 'Amy Roe', IndPhone: '2395550101' },
            {
                env: ENV,
                fetchImpl: async () => ({
                    ok: false,
                    status: 503,
                    json: async () => ({ success: false, error: 'down' }),
                }),
            }
        );
        assert.equal(result.ok, false);
        assert.equal(result.status, 503);
        assert.match(errors.join('\n'), /FAILED source=shannon_voice status=503/);
    } finally {
        console.error = original;
    }
});

test('missing machine key fails closed without calling the CRM', async () => {
    let called = false;
    const result = await submitCrmIntake(
        { source: 'telegram', IndName: 'Amy Roe' },
        { env: {}, fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; } }
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing_machine_key');
    assert.equal(called, false);
});

test('submitCrmIntake aborts a hung CRM call well under the function limit', async () => {
    const result = await submitCrmIntake(
        { source: 'telegram_miniapp', IndName: 'Jane Public' },
        {
            timeoutMs: 30,
            env: ENV,
            fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            }),
        }
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'timeout');
});

test('scanIdImage aborts a hung OCR call', async () => {
    let aborted = false;
    const scan = await scanIdImage('abc123', 'id.jpg', {
        timeoutMs: 30,
        env: ENV,
        fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
                aborted = true;
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
            });
        }),
    });
    assert.equal(aborted, true);
    assert.deepEqual(scan, {});
});
