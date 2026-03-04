/**
 * Smart Notify — AI-Generated Personalized Notifications
 * POST /api/notify
 *
 * Body: { name: string, type: "court-reminder"|"check-in"|"payment-due"|"forfeiture-warning"|"welcome", details: {...} }
 * Returns: { message: string, sms: string, urgency: "low"|"medium"|"high" }
 */
import { getOpenAI, handleOptions, errorResponse, jsonResponse, parseBody, checkRateLimit } from './shared/ai-client.mjs';

const SYSTEM_PROMPT = `You are a notification writer for Shamrock Bail Bonds. Generate personalized, human-sounding notifications.

Return JSON:
- "message": Full message (for Telegram/email, can include emoji)
- "sms": SMS-friendly version (under 160 chars, no emoji, include phone number (239) 332-2245)
- "urgency": "low", "medium", or "high"

RULES:
- Use the person's first name
- Be warm but professional
- For court reminders: include date, time, location, and "Failure to appear will result in a warrant"
- For check-ins: be encouraging, remind them it's quick and easy
- For payment reminders: be gentle but clear about deadlines
- For forfeiture warnings: be VERY clear about consequences — this is serious
- For welcome: be warm, explain next steps, include office phone
- NEVER threaten. Always be helpful.
Return ONLY valid JSON.`;

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const rateLimited = await checkRateLimit(req, 'smart-notify');
    if (rateLimited) return rateLimited;

    const body = await parseBody(req);
    if (!body?.name || !body?.type) {
        return errorResponse('Missing name or type', 400);
    }

    const prompt = `Generate a ${body.type} notification for ${body.name}.

Details: ${JSON.stringify(body.details || {})}`;

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt },
            ],
            max_tokens: 400,
            temperature: 0.6,
        });

        const content = completion.choices[0]?.message?.content || '';

        try {
            const result = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
            return jsonResponse(result);
        } catch {
            return jsonResponse({ message: content, sms: content.slice(0, 160), urgency: 'medium' });
        }
    } catch (err) {
        console.error('[smart-notify] Error:', err.message);
        return errorResponse('Notification generation unavailable: ' + err.message);
    }
};
