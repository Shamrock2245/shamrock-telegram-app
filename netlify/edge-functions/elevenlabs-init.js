/**
 * elevenlabs-init.js — Edge Function (FAST — near-zero cold start)
 *
 * Fires at the start of every inbound Twilio call to the Shamrock
 * After-Hours agent. Returns:
 *   - Caller context from Google Sheets (via GAS, cached)
 *   - Past conversation memories from Mem0
 *   - Personalized first message based on available data
 *
 * Edge functions run on Deno at the CDN edge (<50ms startup)
 * vs serverless functions (3-8s cold start).
 *
 * URL: https://shamrock-telegram.netlify.app/api/elevenlabs-init
 */

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyCIDPzA_EA1B1SGsfhYiXRGKM8z61EgACZdDPILT_MjjXee0wSDEI0RRYthE0CvP-Z/exec';
const MEM0_API_URL = 'https://api.mem0.ai/v1/memories/';
const CONTEXT_TIMEOUT_MS = 1800; // 1.8s max per fetch — well within ElevenLabs timeout

export default async (request, context) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // CORS preflight — instant
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    try {
        // ── Parse caller info ──────────────────────────────
        let callerPhone = '';
        let callSid = '';

        if (request.method === 'POST') {
            try {
                const body = await request.json();
                console.log('📞 ElevenLabs init (edge):', JSON.stringify(body));
                callerPhone = body.caller_id || body.from || body.From || '';
                callSid = body.call_sid || body.CallSid || '';
            } catch (e) {
                console.warn('Body parse failed:', e.message);
            }
        }

        // Fallback: query params
        if (!callerPhone || !callSid) {
            const url = new URL(request.url);
            if (!callerPhone) callerPhone = url.searchParams.get('caller_id') || url.searchParams.get('From') || '';
            if (!callSid) callSid = url.searchParams.get('call_sid') || url.searchParams.get('CallSid') || '';
        }

        // Clean to digits, format for display
        const digits = callerPhone.replace(/\D/g, '');
        const last4 = digits.slice(-4);
        const displayPhone = digits.length === 10
            ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
            : digits.length === 11 && digits[0] === '1'
                ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
                : callerPhone;

        console.log(`📞 Caller: ${displayPhone} | SID: ${callSid}`);

        // ── Parallel fetch: GAS case context + Mem0 memories ─
        const memoApiKey = Deno.env.get('MEMO_API_KEY') || '';
        const normalizedPhone = digits.slice(-10); // last 10 digits

        let caseContext = null;
        let memories = [];

        if (normalizedPhone.length >= 7) {
            // Race both fetches with a timeout
            const withTimeout = (promise, ms) =>
                Promise.race([
                    promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
                ]);

            const [gasResult, mem0Result] = await Promise.allSettled([
                // Fetch 1: GAS caller context (CacheService-backed, ~200ms on cache hit)
                withTimeout(
                    fetch(`${GAS_ENDPOINT}?source=caller_context&phone=${normalizedPhone}`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'text/plain' }
                    }).then(r => r.json()),
                    CONTEXT_TIMEOUT_MS
                ),
                // Fetch 2: Mem0 memories for this caller
                memoApiKey
                    ? withTimeout(
                        fetch(`${MEM0_API_URL}?user_id=${normalizedPhone}&limit=5`, {
                            method: 'GET',
                            headers: { 'Authorization': `Token ${memoApiKey}` }
                        }).then(r => r.json()),
                        CONTEXT_TIMEOUT_MS
                    )
                    : Promise.resolve([])
            ]);

            if (gasResult.status === 'fulfilled' && gasResult.value?.has_existing_case) {
                caseContext = gasResult.value;
                console.log(`✅ Case context found: ${caseContext.has_existing_case} | ${caseContext.defendant_name || ''}`);
            } else {
                console.warn('⚠️ GAS context miss or timeout:', gasResult.reason?.message || gasResult.status);
            }

            if (mem0Result.status === 'fulfilled' && Array.isArray(mem0Result.value) && mem0Result.value.length > 0) {
                memories = mem0Result.value;
                console.log(`✅ Mem0: ${memories.length} memories found for ${normalizedPhone}`);
            } else {
                console.warn('⚠️ Mem0 miss or timeout:', mem0Result.reason?.message || 'no memories');
            }
        }

        // ── Build dynamic_variables ─────────────────────────
        const hasCase = caseContext?.has_existing_case === 'yes';
        const hasMemories = memories.length > 0;
        const isReturning = hasCase || hasMemories;

        // Flatten Mem0 memories into a readable snippet (max 300 chars)
        const memorySummary = hasMemories
            ? memories.slice(0, 3).map(m => m.memory).join(' | ').slice(0, 300)
            : '';

        const dynamicVars = {
            caller_phone: displayPhone,
            caller_phone_raw: normalizedPhone,
            call_sid: callSid,
            // Case file fields
            has_existing_case: hasCase ? 'yes' : 'no',
            caller_name: caseContext?.caller_name || '',
            defendant_name: caseContext?.defendant_name || '',
            bond_amount: caseContext?.bond_amount || '',
            court_date: caseContext?.court_date || '',
            case_status: caseContext?.case_status || '',
            case_reference: caseContext?.case_reference || '',
            // Mem0 memory
            is_returning_caller: isReturning ? 'yes' : 'no',
            caller_memories: memorySummary
        };

        // ── Build personalized first message ─────────────────
        let firstMessage;

        if (hasCase && caseContext.defendant_name && caseContext.caller_name) {
            // Best case: we know who they are AND have a case
            const status = caseContext.case_status
                ? ` Their current status is ${caseContext.case_status}.`
                : '';
            const court = caseContext.court_date
                ? ` Court date is ${caseContext.court_date}.`
                : '';
            firstMessage = `Hi ${caseContext.caller_name}, this is Shannon with Shamrock Bail Bonds. I can see you have an existing case with us regarding ${caseContext.defendant_name}.${status}${court} How can I help you today?`;
        } else if (hasCase && caseContext.defendant_name) {
            // Have a case, not sure who's calling
            firstMessage = `Hi, this is Shannon with Shamrock Bail Bonds. I see there's an existing case regarding ${caseContext.defendant_name}. How can I help you today?`;
        } else if (hasMemories && memorySummary) {
            // We've spoken before, no active case found
            firstMessage = `Hi, welcome back to Shamrock Bail Bonds! This is Shannon. It looks like we've spoken before. How can I help you today?`;
        } else if (last4) {
            // First-time or unrecognized caller with phone
            firstMessage = `Hi, this is Shannon with Shamrock Bail Bonds. I can see you're calling from the number ending in ${last4}. I'm here to help 24/7 — can I get your name to get started?`;
        } else {
            // Total fallback
            firstMessage = `Hi, this is Shannon with Shamrock Bail Bonds. I'm available 24/7 to help you get your loved one home. Can I get your name to start?`;
        }

        // ── Return immediately ───────────────────────────────
        return new Response(JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: dynamicVars,
            conversation_config_override: {
                agent: {
                    first_message: firstMessage
                }
            }
        }), { status: 200, headers });

    } catch (err) {
        console.error('ElevenLabs init error:', err);
        // ALWAYS return a valid response — call must never fail at this stage
        return new Response(JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
                caller_phone: '',
                caller_phone_raw: '',
                call_sid: '',
                has_existing_case: 'no',
                is_returning_caller: 'no',
                caller_name: '',
                defendant_name: '',
                bond_amount: '',
                court_date: '',
                case_status: '',
                case_reference: '',
                caller_memories: ''
            },
            conversation_config_override: {
                agent: {
                    first_message: "Hi, this is Shannon with Shamrock Bail Bonds. I'm available 24/7 to help you get your loved one home. Can I get your name to start?"
                }
            }
        }), { status: 200, headers });
    }
};
