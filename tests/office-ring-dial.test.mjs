// Office Dial TwiML parallel-rings four desks. First answer wins.
// Builders are pure: fetch is stubbed and must not be called. No live Twilio.
import assert from 'node:assert/strict';
import test from 'node:test';

const EXPECTED_NUMBERS = [
    '+12393322245',
    '+12399550301',
    '+12399550178',
    '+12399550314',
];
const SHANNON = '+17272952245';

const fetchCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error('unexpected Twilio call');
};

const { OFFICE_RING_TARGETS, SHANNON_LINE } = await import('../shared/office-ring-targets.js');
const { officeDialTwiml, isHumanDesk } = await import('../netlify/edge-functions/twilio-transfer-office.js');
const { buildDialTwiML, isOfficeLine } = await import('../netlify/edge-functions/twilio-voice-inbound.js');
const { fallbackDialTwiml } = await import('../netlify/edge-functions/twilio-voice-fallback.js');

function dialNumbers(twiml) {
    const dials = [...twiml.matchAll(/<Dial\b([^>]*)>([\s\S]*?)<\/Dial>/g)];
    assert.equal(dials.length, 1, 'one Dial so the numbers ring together');
    const numbers = [...dials[0][2].matchAll(/<Number>([^<]*)<\/Number>/g)].map((match) => match[1]);
    const anywhere = [...twiml.matchAll(/<Number>([^<]*)<\/Number>/g)].map((match) => match[1]);
    assert.deepEqual(anywhere, numbers);
    return { attrs: dials[0][1], numbers };
}

function assertExactRing(twiml, say) {
    const { attrs, numbers } = dialNumbers(twiml);
    assert.deepEqual(numbers, EXPECTED_NUMBERS);
    assert.equal(numbers.includes(SHANNON), false);
    assert.doesNotMatch(twiml, /<Number>\+17272952245<\/Number>/);
    assert.match(attrs, /timeout="25"/);
    assert.match(attrs, /callerId="\+17272952245"/);
    assert.match(attrs, /answerOnBridge="true"/);
    assert.match(twiml, say);
}

test('shared ring list is exactly the four E.164 numbers, in order', () => {
    assert.deepEqual([...OFFICE_RING_TARGETS], EXPECTED_NUMBERS);
    assert.equal(SHANNON_LINE, SHANNON);
    assert.equal(OFFICE_RING_TARGETS.includes(SHANNON), false);
});

test('officeDialTwiml Number targets are exactly the four desks', () => {
    assertExactRing(
        officeDialTwiml(),
        /<Say>The office did not answer\. Please call two three nine, three three two, two two four five\.<\/Say>/,
    );
});

test('buildDialTwiML Number targets are exactly the four desks', () => {
    assertExactRing(
        buildDialTwiML('13055550100'),
        /<Say>Please hold while we connect you to our answering service\.<\/Say>/,
    );
});

test('fallback Dial Number targets are exactly the four desks', () => {
    assertExactRing(
        fallbackDialTwiml(),
        /<Say>We are unable to connect your call right now\. Please call two three nine, three three two, two two four five\.<\/Say>/,
    );
});

test('isHumanDesk and isOfficeLine are true for all four desks', () => {
    for (const number of EXPECTED_NUMBERS) {
        const national = number.slice(2);
        assert.equal(isHumanDesk(number), true, number);
        assert.equal(isOfficeLine(number), true, number);
        assert.equal(isHumanDesk(national), true, national);
        assert.equal(isOfficeLine(national), true, national);
        assert.equal(isHumanDesk(national.slice(0, 3) + '-' + national.slice(3, 6) + '-' + national.slice(6)), true);
    }
    assert.equal(isHumanDesk(SHANNON), false);
    assert.equal(isOfficeLine(SHANNON), false);
    assert.equal(isHumanDesk('7272952245'), false);
    assert.equal(isOfficeLine('727-295-2245'), false);
});

test('an office line is not dialed back into itself', () => {
    for (const number of EXPECTED_NUMBERS) {
        const twiml = buildDialTwiML(number);
        assert.equal(twiml.includes('<Dial'), false, number);
        assert.equal(twiml.includes('<Number>'), false, number);
        assert.doesNotMatch(twiml, /<Number>\+17272952245<\/Number>/);
    }
});

test('dial builders do not call Twilio', () => {
    assert.equal(fetchCalls.length, 0);
    globalThis.fetch = realFetch;
});
