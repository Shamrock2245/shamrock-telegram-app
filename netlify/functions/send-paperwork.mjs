/**
 * Direct paperwork requests are retired.
 *
 * A packet may only be created in Super CRM after a validated Match, BondCase,
 * explicit surety, assigned POA, verified recipient, and staff approval. This
 * endpoint deliberately never forwards intake data, creates a signing link, or
 * sends SMS/email. Historical callers receive an actionable, non-mutating error.
 */

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: JSON_HEADERS });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: JSON_HEADERS
        });
    }

    return new Response(JSON.stringify({
        success: false,
        code: 'DIRECT_PAPERWORK_RETIRED',
        message: 'Direct paperwork requests are retired. Staff must create a verified DocuSeal packet in Super CRM after the Match, BondCase, surety, POA, recipient, and approval checks are complete.'
    }), {
        status: 409,
        headers: JSON_HEADERS
    });
};

export const config = {
    path: '/api/send-paperwork'
};
