import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../intake/app.js', import.meta.url), 'utf8');
const start = src.indexOf('function intakeSavePlan');
const end = src.indexOf('\nfunction ', start + 1);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(start, end), ctx);

test('a network failure and a missing GAS url both keep the browser fallback', () => {
    assert.equal(ctx.intakeSavePlan(null), 'gas_fallback');
    assert.equal(ctx.intakeSavePlan({ success: false, gas_available: false, fallback_attempted: false }), 'gas_fallback');
    assert.equal(ctx.intakeSavePlan({ success: false, fallback_attempted: true, gas_available: false }), 'gas_fallback');
});

test('a server that already tried GAS does not post a second time', () => {
    assert.equal(ctx.intakeSavePlan({ success: false, fallback_attempted: true, gas_available: true }), 'honest_error');
    assert.equal(ctx.intakeSavePlan({ success: true, via: 'crm' }), 'saved');
    assert.equal(ctx.intakeSavePlan({ success: true, via: 'gas_fallback' }), 'saved');
});

test('the submit catch no longer claims a lost lead was saved', () => {
    const submitStart = src.indexOf('function submitForm');
    const submitEnd = src.indexOf('function intakeSavePlan');
    const submit = src.slice(submitStart, submitEnd);
    assert.equal(submit.includes('saved your info'), false);
    assert.equal(submit.includes('saveThroughGas'), true);
    assert.equal(submit.includes('honestSaveFailure'), true);
    assert.equal(submit.includes('uploadIntakeIds'), true);
    assert.match(submit, /We could not save your application/);
});
