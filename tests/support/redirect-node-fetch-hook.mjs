// OpenAI 4.x on Node binds `node-fetch`, not global fetch. Resolve that specifier
// to the test shim so chat requests hit the mocked global fetch.
export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'node-fetch') {
        return {
            url: new URL('./fake-node-fetch.mjs', import.meta.url).href,
            shortCircuit: true,
        };
    }
    return nextResolve(specifier, context);
}
