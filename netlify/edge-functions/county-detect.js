/**
 * County Detection — Edge Function
 * Runs on every page load.
 *
 * Detects if the visitor is in a Florida county Shamrock serves
 * and injects geo context for personalization.
 */

// Florida counties Shamrock Bail Bonds serves
const SERVED_COUNTIES = {
    'lee': { name: 'Lee County', office: 'Fort Myers', phone: '(239) 332-2245' },
    'collier': { name: 'Collier County', office: 'Naples', phone: '(239) 332-2245' },
    'charlotte': { name: 'Charlotte County', office: 'Port Charlotte', phone: '(239) 332-2245' },
    'hendry': { name: 'Hendry County', office: 'LaBelle', phone: '(239) 332-2245' },
    'glades': { name: 'Glades County', office: 'Moore Haven', phone: '(239) 332-2245' },
    'sarasota': { name: 'Sarasota County', office: 'Sarasota', phone: '(239) 332-2245' },
    'desoto': { name: 'DeSoto County', office: 'Arcadia', phone: '(239) 332-2245' },
};

// Map known cities to counties
const CITY_TO_COUNTY = {
    'fort myers': 'lee', 'cape coral': 'lee', 'lehigh acres': 'lee', 'bonita springs': 'lee',
    'estero': 'lee', 'sanibel': 'lee', 'fort myers beach': 'lee',
    'naples': 'collier', 'marco island': 'collier', 'immokalee': 'collier', 'golden gate': 'collier',
    'port charlotte': 'charlotte', 'punta gorda': 'charlotte', 'englewood': 'charlotte',
    'labelle': 'hendry', 'clewiston': 'hendry',
    'moore haven': 'glades',
    'sarasota': 'sarasota', 'venice': 'sarasota', 'north port': 'sarasota',
    'arcadia': 'desoto',
};

export default async (request, context) => {
    const geo = context.geo;
    const response = await context.next();

    // Only process for Florida visitors
    if (geo?.country?.code !== 'US' || geo?.subdivision?.code !== 'FL') {
        response.headers.set('x-shamrock-county', 'none');
        response.headers.set('x-shamrock-in-area', 'false');
        return response;
    }

    // Try to match city to county
    const city = (geo.city || '').toLowerCase().trim();
    const countyKey = CITY_TO_COUNTY[city];

    if (countyKey && SERVED_COUNTIES[countyKey]) {
        const county = SERVED_COUNTIES[countyKey];
        response.headers.set('x-shamrock-county', countyKey);
        response.headers.set('x-shamrock-county-name', county.name);
        response.headers.set('x-shamrock-office', county.office);
        response.headers.set('x-shamrock-in-area', 'true');

        // Set a cookie for client-side personalization
        response.headers.append(
            'Set-Cookie',
            `shamrock_county=${countyKey}; Path=/; Max-Age=86400; SameSite=Lax`
        );
        response.headers.append(
            'Set-Cookie',
            `shamrock_county_name=${encodeURIComponent(county.name)}; Path=/; Max-Age=86400; SameSite=Lax`
        );
    } else {
        // Florida but not in a served county
        response.headers.set('x-shamrock-county', 'other-fl');
        response.headers.set('x-shamrock-in-area', 'false');
        if (city) {
            response.headers.set('x-shamrock-city', city);
        }
    }

    response.headers.set('x-shamrock-state', 'FL');
    return response;
};
