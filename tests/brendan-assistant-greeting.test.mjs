// Brendan paperwork assistant: each inbound call picks one of 10 greetings
// and sends it as conversation_config_override.agent.first_message.
// No Twilio or ElevenLabs network calls.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BRENDAN_ASSISTANT_GREETINGS,
    pickBrendanAssistantGreeting,
    brendanAssistantFirstMessageOverride,
} from '../netlify/lib/brendan-assistant-greeting.js';
import { aiPathConversationInitiationClientData } from '../netlify/edge-functions/twilio-voice-inbound.js';

const EXACT_GREETINGS = [
    "Hi, this is Brendan's assistant at Shamrock Bail Bonds. How can I help?",
    "Shamrock Bail Bonds, Brendan's assistant speaking. How can I help?",
    "Thanks for calling Shamrock Bail Bonds. This is Brendan's assistant. Are you calling about someone who's been arrested?",
    "Shamrock Bail Bonds, this is Brendan's assistant. What can I do for you?",
    "Hi, you've reached Shamrock Bail Bonds. I'm Brendan's assistant. Who are you calling about?",
    "Thanks for calling Shamrock. This is Brendan's assistant. How can I help you today?",
    "Shamrock Bail Bonds, this is Brendan's assistant. We're here 24/7. What can I do for you?",
    "Shamrock Bail Bonds, Brendan's assistant here. Is this about someone in jail?",
    "Hi, this is Brendan's assistant at Shamrock Bail Bonds. I'm here to help. What's going on?",
    "Hello, Shamrock Bail Bonds. This is Brendan's assistant. Take a breath, I'm here to help. Who are we helping today?",
];

test('the greeting list is the 10 verbatim lines', () => {
    assert.equal(BRENDAN_ASSISTANT_GREETINGS.length, 10);
    assert.deepEqual([...BRENDAN_ASSISTANT_GREETINGS], EXACT_GREETINGS);
    for (const line of BRENDAN_ASSISTANT_GREETINGS) {
        assert.match(line, /Brendan's assistant/);
        assert.doesNotMatch(line, /shannon/i);
        assert.doesNotMatch(line, /this is brendan[.!]/i);
    }
});

test('pickBrendanAssistantGreeting is uniform over the 10 lines', () => {
    for (let i = 0; i < EXACT_GREETINGS.length; i += 1) {
        const start = i / EXACT_GREETINGS.length;
        assert.equal(pickBrendanAssistantGreeting(() => start), EXACT_GREETINGS[i]);
        assert.equal(pickBrendanAssistantGreeting(() => start + 0.099999), EXACT_GREETINGS[i]);
    }
    assert.equal(pickBrendanAssistantGreeting(() => 0), EXACT_GREETINGS[0]);
    assert.equal(pickBrendanAssistantGreeting(() => 0.999999), EXACT_GREETINGS[9]);
});

test('every random pick is one of the 10', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
        const line = pickBrendanAssistantGreeting();
        assert.ok(EXACT_GREETINGS.includes(line), line);
        seen.add(line);
    }
    assert.ok(seen.size >= 2);
});

test('first_message override payload uses the chosen greeting', () => {
    const chosen = EXACT_GREETINGS[4];
    assert.deepEqual(brendanAssistantFirstMessageOverride(chosen), {
        agent: { first_message: chosen },
    });
});

test('elevenlabs-init sends conversation_initiation_client_data with that override', async () => {
    const { default: handler } = await import('../netlify/edge-functions/elevenlabs-init.js');
    const previousRandom = Math.random;
    const previousDeno = globalThis.Deno;
    Math.random = () => 0.34;
    globalThis.Deno = { env: { get() { return ''; } } };
    try {
        const anonymous = await handler(new Request('https://example.test/api/elevenlabs-init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }));
        assert.equal(anonymous.status, 200);
        const empty = await anonymous.json();
        assert.deepEqual(empty, {
            type: 'conversation_initiation_client_data',
            conversation_config_override: {
                agent: { first_message: EXACT_GREETINGS[3] },
            },
        });

        const known = await handler(new Request('https://example.test/api/elevenlabs-init?caller_id=%2B15555550100', {
            method: 'GET',
        }));
        assert.equal(known.status, 200);
        const withCaller = await known.json();
        assert.equal(withCaller.type, 'conversation_initiation_client_data');
        assert.equal(withCaller.conversation_config_override.agent.first_message, EXACT_GREETINGS[3]);
        assert.equal(withCaller.dynamic_variables.caller_phone, '+15555550100');
        assert.equal(withCaller.dynamic_variables.returning_client, 'no');
    } finally {
        Math.random = previousRandom;
        if (previousDeno === undefined) delete globalThis.Deno;
        else globalThis.Deno = previousDeno;
    }
});

test('twilio AI path client data keeps dynamic variables and sets first_message', () => {
    const chosen = EXACT_GREETINGS[7];
    const payload = aiPathConversationInitiationClientData({
        from: '+15555550100',
        callSid: 'CA_test',
        mem0: { returning_client: 'yes', known_defendant: 'Sam', prior_notes: 'prior' },
        digits: '15555550100',
        greeting: chosen,
    });
    assert.deepEqual(payload, {
        dynamic_variables: {
            caller_phone: '+15555550100',
            caller_id: '+15555550100',
            call_sid: 'CA_test',
            returning_client: 'yes',
            known_defendant: 'Sam',
            prior_notes: 'prior',
            is_jail_call: 'no',
            jail_facility: '',
        },
        conversation_config_override: {
            agent: { first_message: chosen },
        },
        source_info: { source: 'twilio' },
    });

    const jail = aiPathConversationInitiationClientData({
        from: '+15555550199',
        callSid: 'CA_jail',
        digits: '12394771500',
        greeting: EXACT_GREETINGS[0],
    });
    assert.equal(jail.dynamic_variables.is_jail_call, 'yes');
    assert.equal(jail.dynamic_variables.jail_facility, 'Lee County Jail (Press 0 to talk to inmate)');
    assert.equal(jail.conversation_config_override.agent.first_message, EXACT_GREETINGS[0]);
    assert.ok(EXACT_GREETINGS.includes(jail.conversation_config_override.agent.first_message));
});
