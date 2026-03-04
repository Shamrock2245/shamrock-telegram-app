/**
 * Charge Analyzer — Parse Florida Criminal Charges
 * POST /api/charges
 *
 * Body: { charges: "string of charges from booking sheet" }
 * Returns: { parsed: [{ code, statute, description, severity, category, bondRange }] }
 */
import { getGrok, handleOptions, errorResponse, jsonResponse, parseBody, checkRateLimit } from './shared/ai-client.mjs';

const SYSTEM_PROMPT = `You are a Florida criminal law expert specializing in bail bonds. Parse criminal charges from booking sheets.

For each charge, return a JSON object with:
- "parsed": array of charge objects, each with:
  - "code": the charge code/statute number as written
  - "statute": Florida Statute reference (e.g., "F.S. 893.13")
  - "description": human-readable description of the charge
  - "severity": "capital-felony" | "life-felony" | "first-degree-felony" | "second-degree-felony" | "third-degree-felony" | "first-degree-misdemeanor" | "second-degree-misdemeanor" | "noncriminal-violation"
  - "category": "violent" | "drug" | "property" | "dui" | "domestic" | "sex-offense" | "traffic" | "fraud" | "other"
  - "bondRange": estimated bond range string (e.g., "$5,000 - $15,000")
  - "enhanceable": boolean — true if charge can be enhanced (habitual offender, prior DUI, etc.)

Return ONLY valid JSON. If you cannot identify a charge, include it with severity "unknown" and note in description.`;

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const rateLimited = await checkRateLimit(req, 'charge-analyzer');
    if (rateLimited) return rateLimited;

    const body = await parseBody(req);
    if (!body?.charges) {
        return errorResponse('Missing charges field', 400);
    }

    try {
        const grok = getGrok();
        const completion = await grok.chat.completions.create({
            model: 'grok-3-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Parse these Florida charges:\n\n${body.charges}` },
            ],
            max_tokens: 800,
            temperature: 0.2,
        });

        const content = completion.choices[0]?.message?.content || '';

        try {
            const result = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
            return jsonResponse(result);
        } catch {
            return jsonResponse({ parsed: [], raw: content });
        }
    } catch (err) {
        console.error('[charge-analyzer] Error:', err.message);
        return errorResponse('Charge analysis unavailable: ' + err.message);
    }
};
