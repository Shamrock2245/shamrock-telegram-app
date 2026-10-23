// Stand-in for node-fetch v2. OpenAI 4.x reads `default`, `Headers`, `Request`,
// and `Response` off this module. Calls delegate to the mocked global fetch.
function fetch(url, init) {
    return globalThis.fetch(url, init);
}

export default fetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export class FetchError extends Error {}
export class AbortError extends Error {}
