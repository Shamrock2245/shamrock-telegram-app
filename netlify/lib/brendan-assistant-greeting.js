/**
 * Per-call greeting for the Brendan paperwork assistant (+17272952245).
 * One of these lines is sent as the ElevenLabs first_message override.
 * Agent dashboard config is not changed here.
 */

export const BRENDAN_ASSISTANT_GREETINGS = Object.freeze([
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
]);

export function pickBrendanAssistantGreeting(random = Math.random) {
    const index = Math.floor(random() * BRENDAN_ASSISTANT_GREETINGS.length);
    return BRENDAN_ASSISTANT_GREETINGS[index];
}

/** conversation_config_override.agent.first_message for conversation_initiation_client_data. */
export function brendanAssistantFirstMessageOverride(firstMessage = pickBrendanAssistantGreeting()) {
    return { agent: { first_message: firstMessage } };
}
