/**
 * Language Detection — Edge Function
 * Runs on every page load.
 *
 * Detects preferred language from Accept-Language header
 * and sets headers/cookies for Spanish and Haitian Creole users.
 */

const SUPPORTED_LANGS = {
    'es': { name: 'Spanish', greeting: '¡Bienvenido!' },
    'ht': { name: 'Haitian Creole', greeting: 'Byenvini!' },
    'fr': { name: 'French', greeting: 'Bienvenue!' },
    'pt': { name: 'Portuguese', greeting: 'Bem-vindo!' },
};

export default async (request, context) => {
    const response = await context.next();

    // Parse Accept-Language header
    const acceptLang = request.headers.get('Accept-Language') || '';
    const primaryLang = parseAcceptLanguage(acceptLang);

    if (primaryLang && primaryLang !== 'en' && SUPPORTED_LANGS[primaryLang]) {
        const lang = SUPPORTED_LANGS[primaryLang];
        response.headers.set('x-shamrock-lang', primaryLang);
        response.headers.set('x-shamrock-lang-name', lang.name);
        response.headers.set('x-shamrock-greeting', lang.greeting);

        // Cookie for client-side language switching
        response.headers.append(
            'Set-Cookie',
            `shamrock_lang=${primaryLang}; Path=/; Max-Age=604800; SameSite=Lax`
        );
    } else {
        response.headers.set('x-shamrock-lang', 'en');
    }

    return response;
};

/**
 * Parse Accept-Language header and return the best non-English primary language.
 * e.g., "es-MX,es;q=0.9,en;q=0.8" → "es"
 */
function parseAcceptLanguage(header) {
    if (!header) return 'en';

    const languages = header
        .split(',')
        .map((entry) => {
            const [lang, qPart] = entry.trim().split(';');
            const quality = qPart ? parseFloat(qPart.replace('q=', '')) : 1.0;
            const code = lang.split('-')[0].toLowerCase();
            return { code, quality };
        })
        .sort((a, b) => b.quality - a.quality);

    // Return the highest-priority supported non-English language
    for (const { code } of languages) {
        if (code !== 'en' && SUPPORTED_LANGS[code]) {
            return code;
        }
    }

    // If all supported languages are English or unsupported
    return languages[0]?.code || 'en';
}
