import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

const FUNCTIONS_DIR = new URL('../netlify/functions/', import.meta.url);

test('compliance-digest loads and keeps its daily schedule', async () => {
    const mod = await import(new URL('compliance-digest.mjs', FUNCTIONS_DIR));
    assert.equal(typeof mod.default, 'function');
    assert.deepEqual(mod.config, { schedule: '0 13 * * *' });
});

test('every Netlify function module loads without a missing named export', async () => {
    const files = readdirSync(FUNCTIONS_DIR).filter((name) => name.endsWith('.mjs')).sort();
    assert.ok(files.length > 0, 'expected Netlify function files');
    const failures = [];
    for (const name of files) {
        try {
            const mod = await import(new URL(name, FUNCTIONS_DIR));
            if (typeof mod.default !== 'function') failures.push(name + ': no default handler');
        } catch (err) {
            failures.push(name + ': ' + (err && err.message));
        }
    }
    assert.deepEqual(failures, []);
});
