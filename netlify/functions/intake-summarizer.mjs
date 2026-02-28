/**
 * Intake Summarizer — AI Summary for Staff
 * POST /api/summarize
 *
 * Body: { defendant: {...}, indemnitor: {...}, charges: string, bondAmount: string, ... }
 * Returns: { summary: string, priority: "urgent|normal|low", tags: string[] }
 */
import { getOpenAI, handleOptions, errorResponse, jsonResponse, parseBody } from './shared/ai-client.mjs';

const SYSTEM_PROMPT = `You are a bail bond office assistant. Summarize new intake submissions for the staff Slack channel.

Return a JSON object:
- "summary": 3-sentence summary with key facts (defendant name, charges, bond amount, indemnitor, county). Use a professional but urgent tone.
- "priority": "urgent" (violent felony, high bond >$50k), "normal" (standard), or "low" (misdemeanor, small bond)
- "tags": array of relevant tags like ["felony", "DUI", "lee-county", "high-bond", "payment-plan", "walk-in"]

Format the summary like a Slack message — concise, scannable, emoji-friendly.
Return ONLY valid JSON.`;

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const body = await parseBody(req);
    if (!body) return errorResponse('Missing request body', 400);

    const intakeText = JSON.stringify(body, null, 2);

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Summarize this bail bond intake:\n\n${intakeText}` },
            ],
            max_tokens: 400,
            temperature: 0.4,
        });

        const content = completion.choices[0]?.message?.content || '';

        try {
            const result = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
            return jsonResponse(result);
        } catch {
            return jsonResponse({
                summary: content,
                priority: 'normal',
                tags: [],
            });
        }
    } catch (err) {
        console.error('[intake-summarizer] Error:', err.message);
        return errorResponse('Summarization unavailable: ' + err.message);
    }
};
