/**
 * AI Concierge — 24/7 Bail Bond Chatbot
 * POST /api/chat
 *
 * Body: { messages: [{ role, content }], sessionId?: string }
 * Returns: Streamed chat completion
 */
import { getOpenAI, CORS_HEADERS, handleOptions, errorResponse, parseBody } from './shared/ai-client.mjs';

const SYSTEM_PROMPT = `You are the Shamrock Bail Bonds AI Concierge — a calm, professional, and compassionate assistant helping families navigate the bail process in Florida.

PERSONALITY:
- Warm but efficient. You know people are scared and in crisis.
- Use simple language. Avoid legal jargon unless asked.
- Always reassure: "We're here to help, 24/7."
- Be brief. Most users are on phones in stressful situations.

KNOWLEDGE:
- Shamrock Bail Bonds serves all of Southwest Florida (Lee, Collier, Charlotte, Hendry, Glades counties)
- Office phone: (239) 332-2245
- We accept all major payment methods and offer payment plans
- Bail process: Arrest → Booking → Bail Set → Bond Posted → Release (typically 2-6 hours after bond posted)
- We can help with: posting bail, explaining charges, court date info, payment plans, check-in schedules
- For emergencies or to start a bond immediately, tell them to call (239) 332-2245 or use the Start a Bond button

RULES:
- NEVER give legal advice. Say "I'm not a lawyer, but I can help you understand the bail process."
- NEVER guarantee release times. Say "typically" or "in most cases."
- If someone asks about a specific case, direct them to look it up in the Status tab or call the office.
- If unsure, say "Let me connect you with our team" and suggest calling (239) 332-2245.
- Keep responses under 3 sentences unless the user asks for more detail.`;

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const body = await parseBody(req);
    if (!body?.messages || !Array.isArray(body.messages)) {
        return errorResponse('Missing messages array', 400);
    }

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...body.messages.slice(-10), // Keep last 10 messages for context
            ],
            max_tokens: 500,
            temperature: 0.7,
            stream: true,
        });

        // Stream the response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of completion) {
                        const content = chunk.choices[0]?.delta?.content;
                        if (content) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                        }
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                } catch (err) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (err) {
        console.error('[ai-concierge] Error:', err.message);
        return errorResponse('AI service unavailable: ' + err.message);
    }
};
