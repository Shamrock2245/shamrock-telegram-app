import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSrc = fs.readFileSync(new URL('../status/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../status/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../status/styles.css', import.meta.url), 'utf8');

function loadStatusApp() {
    const context = {
        console,
        document: {
            addEventListener() {},
            getElementById() { return null; }
        },
        Intl,
        Date,
        Number,
        String
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(appSrc, context);
    return context;
}

const app = loadStatusApp();
const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime();

function stagesOf(data) {
    return JSON.parse(JSON.stringify(app.buildStatusTimeline(data, NOW)));
}

function fullCase() {
    return {
        name: 'Alex Rivera',
        phone: '2395550100',
        status: 'Active',
        courtDates: {
            nextDate: '2026-11-02',
            courtroom: '3B',
            judge: 'Judge Hale'
        },
        payment: {
            nextDue: '2026-10-20',
            amountDue: 150,
            remainingBalance: 400,
            lastPayment: '2026-09-01'
        },
        caseSummary: {
            bondAmount: 5000,
            charges: 'Example charge',
            postingDate: '2026-08-01',
            caseNumber: '26-CF-100'
        },
        documents: [{ name: 'Packet', url: 'https://example.invalid/packet' }]
    };
}

test('timeline stages map 1:1 to lookup date fields and skip everything else', () => {
    const stages = stagesOf(fullCase());
    assert.deepEqual(stages.map((stage) => stage.id), [
        'bond-posted',
        'last-payment',
        'payment-due',
        'next-court'
    ]);
    assert.deepEqual(stages.map((stage) => stage.field), [
        'caseSummary.postingDate',
        'payment.lastPayment',
        'payment.nextDue',
        'courtDates.nextDate'
    ]);
    assert.equal(stages[0].state, 'done');
    assert.equal(stages[0].note, 'Bond amount $5,000.00');
    assert.equal(stages[2].note, 'Amount due $150.00');
    assert.equal(stages[3].note, '3B · Judge Hale');
    assert.equal(stages[3].state, 'upcoming');
    assert.ok(stages.every((stage) => !/document/i.test(stage.field)));
});

test('missing, null, and placeholder fields are not stages', () => {
    const data = fullCase();
    data.caseSummary.postingDate = null;
    data.payment.lastPayment = '—';
    data.payment.nextDue = '';
    data.courtDates.nextDate = 'n/a';
    data.bondPosted = true;
    data.documentsSigned = 4;
    assert.deepEqual(stagesOf(data), []);
    assert.match(app.timelineEmptyMessage(data), /bond posting date/i);
});

test('courtroom or amount alone does not invent a stage', () => {
    const stages = stagesOf({
        status: 'Active',
        courtDates: { nextDate: null, courtroom: '3B', judge: 'Judge Hale' },
        payment: { nextDue: null, amountDue: 80, remainingBalance: 80, lastPayment: null },
        caseSummary: { bondAmount: 1000, charges: 'Example', postingDate: null, caseNumber: '1' },
        documents: []
    });
    assert.deepEqual(stages, []);
});

test('a single real date still renders, and unparseable text stays On file', () => {
    const stages = stagesOf({
        caseSummary: { postingDate: 'Posted at booking' },
        courtDates: null,
        payment: null
    });
    assert.equal(stages.length, 1);
    assert.equal(stages[0].id, 'bond-posted');
    assert.equal(stages[0].state, 'recorded');
    assert.equal(stages[0].stateLabel, 'On file');
    assert.equal(stages[0].detail, 'Posted at booking');
    assert.equal(stages[0].note, '');
});

test('today is its own state and offline copy does not invent steps', () => {
    const stages = stagesOf({
        payment: { nextDue: '10/08/2026', amountDue: null }
    });
    assert.equal(stages.length, 1);
    assert.equal(stages[0].id, 'payment-due');
    assert.equal(stages[0].state, 'today');
    assert.equal(stages[0].note, '');

    const offline = app.timelineEmptyMessage({ _offline: true, status: 'Offline' });
    assert.match(offline, /couldn.t load your case timeline/i);
    assert.equal(stagesOf({ _notFound: true, caseSummary: { postingDate: '2026-08-01' } }).length, 0);
});

test('status page uses the shared skeleton and does not add document stages', () => {
    assert.match(appSrc, /classList\.add\('skeleton-loading'\)/);
    assert.match(appSrc, /classList\.remove\('skeleton-loading'\)/);
    assert.match(html, /id="statusTimeline"/);
    assert.match(html, /class="[^"]*status-card/);
    assert.match(html, /id="noPayment"/);
    assert.match(html, /332-2245/);
    assert.doesNotMatch(html, /No documents on file yet/);
    assert.match(css, /\.status-timeline/);
    assert.match(css, /min-height:\s*44px/);
    assert.doesNotMatch(appSrc, /signing complete|packet signed|bondPosted|label:\s*'Documents'/);
    assert.match(appSrc, /miniappLookup\(STATUS_CONFIG\.ACTION_LOOKUP/);
    assert.doesNotMatch(appSrc, /script\.google\.com|\/exec/);
});
