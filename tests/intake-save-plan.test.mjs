import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../intake/app.js', import.meta.url), 'utf8');
const start = src.indexOf('function intakeSavePlan');
const end = src.indexOf('\nfunction uploadFileToGAS');
const ctx = { Promise, console };
vm.createContext(ctx);
vm.runInContext(src.slice(start, end), ctx);

test('anything other than a CRM success uses one browser GAS save', () => {
    assert.equal(ctx.intakeSavePlan(null), 'gas_fallback');
    assert.equal(ctx.intakeSavePlan({}), 'gas_fallback');
    assert.equal(ctx.intakeSavePlan({ success: false, error: 'crm_failed', via: 'crm_failed' }), 'gas_fallback');
    assert.equal(ctx.intakeSavePlan({ success: false, fallback_attempted: true, gas_available: true }), 'gas_fallback');
    assert.equal(ctx.intakeSavePlan({ success: true, via: 'crm' }), 'saved');
});

test('a CRM miss saves through GAS exactly once and does not say the lead was lost', async () => {
    let gasSaves = 0;
    let alerts = 0;
    await ctx.settleCrmResult(
        { success: false, via: 'crm_failed', error: 'crm_failed' },
        {
            uploadIntakeIds() { throw new Error('ID upload belongs inside the GAS save'); },
            saveThroughGas() {
                gasSaves += 1;
                return Promise.resolve();
            },
            honestSaveFailure() { alerts += 1; },
        },
    );
    assert.equal(gasSaves, 1);
    assert.equal(alerts, 0);
});

test('a CRM success does not save through GAS', async () => {
    let gasSaves = 0;
    let uploads = 0;
    await ctx.settleCrmResult(
        { success: true, via: 'crm', intake_id: 'TG-1' },
        {
            uploadIntakeIds() {
                uploads += 1;
                return Promise.resolve();
            },
            notifyTelegram() {},
            saveThroughGas() {
                gasSaves += 1;
                return Promise.resolve();
            },
        },
    );
    assert.equal(gasSaves, 0);
    assert.equal(uploads, 1);
});

test('a failed browser GAS save alerts once and does not post again', async () => {
    let gasSaves = 0;
    let alerts = 0;
    function saveThroughGas() {
        gasSaves += 1;
        const err = new Error('gas_failed');
        err.gasAttempted = true;
        return Promise.reject(err);
    }
    const error = await ctx.settleCrmResult(
        { success: false, via: 'crm_failed', error: 'crm_failed' },
        { saveThroughGas },
    ).then(() => null, (err) => err);
    await ctx.recoverIntakeSave(error, {
        honestSaveFailure() { alerts += 1; },
        saveThroughGas,
    });
    assert.equal(gasSaves, 1);
    assert.equal(alerts, 1);
});

test('a network failure before a response saves through GAS once', async () => {
    let gasSaves = 0;
    let alerts = 0;
    await ctx.recoverIntakeSave(new Error('Failed to fetch'), {
        honestSaveFailure() { alerts += 1; },
        saveThroughGas() {
            gasSaves += 1;
            return Promise.resolve();
        },
    });
    assert.equal(gasSaves, 1);
    assert.equal(alerts, 0);
});

test('the submit catch no longer claims a lost lead was saved', () => {
    const submitStart = src.indexOf('function submitForm');
    const submitEnd = src.indexOf('function intakeSavePlan');
    const submit = src.slice(submitStart, submitEnd);
    assert.equal(submit.includes('saved your info'), false);
    assert.equal(submit.includes('saveThroughGas'), true);
    assert.equal(submit.includes('honestSaveFailure'), true);
    assert.equal(submit.includes('settleCrmResult'), true);
    assert.equal(submit.includes('uploadIntakeIds'), true);
    assert.match(submit, /We could not save your application/);
});
