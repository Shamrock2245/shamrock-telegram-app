import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const FUNCTIONS_DIR = new URL('../netlify/functions/', import.meta.url);

test('compliance-digest loads, has a handler, and is NOT scheduled', async () => {
    const mod = await import(new URL('compliance-digest.mjs', FUNCTIONS_DIR));
    assert.equal(typeof mod.default, 'function');
    assert.equal(mod.config?.schedule, undefined, 'compliance-digest must not export a schedule');
});

test('netlify.toml does not schedule compliance-digest', async () => {
    const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
    const lines = toml.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
    let section = '';
    const scheduled = [];
    for (const line of lines) {
        if (line.startsWith('[')) section = line;
        else if (/^schedule\s*=/.test(line)) scheduled.push(section);
    }
    assert.deepEqual(scheduled.filter((s) => s.includes('compliance-digest')), []);
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
