/**
 * Risk Score — AI Flight Risk Assessment
 * POST /api/risk-score
 *
 * Body: { charges: string, address: string, age?: number, priors?: string, employment?: string }
 * Returns: { score: 0-100, risk: "low|medium|high", explanation: string, factors: string[] }
 */
import { getGrok, handleOptions, errorResponse, jsonResponse, parseBody, checkRateLimit } from './shared/ai-client.mjs';

const SYSTEM_PROMPT = `You are an expert bail bond underwriter for Shamrock Bail Bonds in Florida. Your job is to assess flight risk for bail bond applicants.

Evaluate the defendant and return a JSON object with:
- "score": integer 0-100 (0 = minimal risk, 100 = extreme flight risk)
- "risk": "low" (0-30), "medium" (31-60), or "high" (61-100)
- "explanation": 2-3 sentence summary of the risk assessment
- "factors": array of 3-5 specific risk factors identified (strings)

RISK FACTORS TO CONSIDER:
1. Severity of charges (felony vs misdemeanor, violent vs non-violent)
2. Local ties (Florida resident? Own property? Family nearby?)
3. Criminal history (prior FTAs, prior arrests, warrants)
4. Employment stability
5. Age (very young or transient = higher risk)
6. Nature of charges (drug trafficking, DUI, domestic violence patterns)
7. Bond amount relative to means

ALWAYS return valid JSON. No markdown, no code blocks, just the JSON object.`;

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const rateLimited = await checkRateLimit(req, 'risk-score');
    if (rateLimited) return rateLimited;

    const body = await parseBody(req);
    if (!body?.charges) {
        return errorResponse('Missing charges field', 400);
    }

    const userPrompt = `Assess flight risk for this defendant:

Charges: ${body.charges}
Address: ${body.address || 'Not provided'}
Age: ${body.age || 'Unknown'}
Prior Record: ${body.priors || 'Unknown'}
Employment: ${body.employment || 'Unknown'}`;

    try {
        const grok = getGrok();
        const completion = await grok.chat.completions.create({
            model: 'grok-3-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 500,
            temperature: 0.3,
        });

        const content = completion.choices[0]?.message?.content || '';

        // Parse JSON from response
        try {
            const result = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
            return jsonResponse(result);
        } catch {
            // If JSON parsing fails, return raw content
            return jsonResponse({
                score: 50,
                risk: 'medium',
                explanation: content,
                factors: ['Unable to parse structured assessment'],
            });
        }
    } catch (err) {
        console.error('[risk-score] Error:', err.message);
        return errorResponse('Risk scoring unavailable: ' + err.message);
    }
};
