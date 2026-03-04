/**
 * Translation — Real-time Spanish/Creole Translation
 * POST /api/translate
 *
 * Body: { text: string, targetLang: "es" | "ht" | "en", context?: "legal" | "general" }
 * Returns: { translated: string, sourceLang: string, targetLang: string }
 */
import { getOpenAI, handleOptions, errorResponse, jsonResponse, parseBody, checkRateLimit } from './shared/ai-client.mjs';

const LANG_MAP = {
    es: 'Spanish',
    ht: 'Haitian Creole',
    en: 'English',
    pt: 'Portuguese',
    fr: 'French',
};

export default async (req) => {
    if (req.method === 'OPTIONS') return handleOptions();
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

    const rateLimited = await checkRateLimit(req, 'translate');
    if (rateLimited) return rateLimited;

    const body = await parseBody(req);
    if (!body?.text || !body?.targetLang) {
        return errorResponse('Missing text or targetLang', 400);
    }

    const targetName = LANG_MAP[body.targetLang] || body.targetLang;
    const context = body.context === 'legal'
        ? 'This is bail bond / legal terminology. Translate accurately but keep it understandable for a layperson.'
        : 'Translate naturally and conversationally.';

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a professional translator specializing in legal and bail bond terminology. ${context} Return ONLY the translated text, nothing else.`,
                },
                {
                    role: 'user',
                    content: `Translate the following to ${targetName}:\n\n${body.text}`,
                },
            ],
            max_tokens: 1000,
            temperature: 0.3,
        });

        const translated = completion.choices[0]?.message?.content?.trim() || '';

        return jsonResponse({
            translated,
            sourceLang: 'auto',
            targetLang: body.targetLang,
        });
    } catch (err) {
        console.error('[translate] Error:', err.message);
        return errorResponse('Translation unavailable: ' + err.message);
    }
};
