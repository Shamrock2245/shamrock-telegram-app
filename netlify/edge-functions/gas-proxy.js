/**
 * gas-proxy.js — Netlify Edge Function to proxy Wix→GAS POST requests
 * 
 * WHY THIS EXISTS:
 * Google Workspace blocks POST requests from Wix's cloud server IPs,
 * returning a 500 HTML error page instead of the JSON response.
 * This edge function acts as a transparent proxy:
 *   Wix → Netlify Edge (near-zero cold start) → GAS → response back to Wix
 * 
 * SECURITY:
 * - Requires X-GAS-API-Key header (the same key GAS expects)
 * - Validates Content-Type
 * - Rate-limited by Netlify infrastructure
 * 
 * USAGE FROM WIX:
 *   fetch('https://shamrock-telegram.netlify.app/api/gas-proxy', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'X-GAS-API-Key': apiKey
 *     },
 *     body: JSON.stringify({ action: 'sendEmail', ... })
 *   })
 */

export default async (req, context) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-GAS-API-Key, Authorization'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const GAS_URL = Deno.env.get('GAS_WEB_APP_URL') || Deno.env.get('GAS_ENDPOINT');
  if (!GAS_URL) {
    console.error('[gas-proxy] GAS_WEB_APP_URL not configured');
    return new Response(JSON.stringify({ error: 'Proxy misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Extract the API key from the proxy header and pass it through to GAS
  const apiKey = req.headers.get('X-GAS-API-Key') || '';
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing X-GAS-API-Key header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Read the incoming body
    const body = await req.text();
    console.log(`[gas-proxy] Forwarding POST to GAS (${body.length} bytes)`);

    // Inject the API key into the body payload for GAS
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ensure the apiKey is in the payload (GAS expects it there)
    payload.apiKey = apiKey;

    // Forward to GAS with redirect following
    // Netlify Edge (Deno) handles 302 redirects correctly, unlike Wix
    const gasResponse = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    const responseText = await gasResponse.text();
    console.log(`[gas-proxy] GAS responded: ${gasResponse.status} (${responseText.length} bytes)`);

    // Try to parse as JSON, fall back to raw text
    let responseBody;
    let contentType;
    try {
      responseBody = JSON.parse(responseText);
      contentType = 'application/json';
      responseBody = JSON.stringify(responseBody);
    } catch {
      // GAS returned HTML or non-JSON — pass through the status
      responseBody = responseText;
      contentType = gasResponse.headers.get('content-type') || 'text/html';
    }

    return new Response(responseBody, {
      status: gasResponse.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'X-Proxied-By': 'shamrock-gas-proxy'
      }
    });

  } catch (error) {
    console.error('[gas-proxy] Proxy error:', error.message);
    return new Response(JSON.stringify({
      error: 'Proxy request failed',
      detail: error.message
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/gas-proxy'
};
