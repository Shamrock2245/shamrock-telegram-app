/**
 * Document Explainer — Plain Language Bail Conditions
 * POST /api/explain
 *
 * Body: { documentType: string, conditions: string[], bondAmount?: string, charges?: string }
 * Returns: { explanation: string, warnings: string[], keyDates: string[] }
 */
import { getOpenAI, handleOptions, errorResponse, jsonResponse, parseBody } from './shared/ai-client.mjs';

const SYSTEM_PROMPT = `You are a bail bond explainer for Shamrock Bail Bonds. Your job is to explain bail bond documents and conditions in simple, plain language that anyone can understand — even if they're stressed, scared, and reading on a phone.

Return a JSON object:
- "explanation": Plain-language explanation (3-5 short paragraphs). Use bullet points for lists. Use "you" language. No legal jargon — or if you must use a legal term, immediately explain it in parentheses.
- "warnings": Array of critical things the defendant MUST know (e.g., "You MUST appear at every court date or your bond will be revoked and a warrant issued for your arrest")
- "keyDates": Array of any dates or deadlines mentioned

TONE: Friendly, clear, authoritative. Like a trusted older sibling explaining what's happening.
NEVER give specific legal advice. Always recommend consulting with their attorney for legal questions.
Return ONLY valid JSON.`;

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const body = await parseBody(req);
    if (!body?.documentType) {
        return errorResponse('Missing documentType', 400);
    }

    const prompt = `Explain this bail bond document in plain language:

Document Type: ${body.documentType}
Bond Amount: ${body.bondAmount || 'Not specified'}
Charges: ${body.charges || 'Not specified'}
Conditions: ${body.conditions ? body.conditions.join('\n- ') : 'Standard conditions'}`;

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt },
            ],
            max_tokens: 800,
            temperature: 0.5,
        });

        const content = completion.choices[0]?.message?.content || '';

        try {
            const result = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
            return jsonResponse(result);
        } catch {
            return jsonResponse({
                explanation: content,
                warnings: [],
                keyDates: [],
            });
        }
    } catch (err) {
        console.error('[document-explainer] Error:', err.message);
        return errorResponse('Document explanation unavailable: ' + err.message);
    }
};
