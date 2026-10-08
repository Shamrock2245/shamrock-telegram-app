import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    HTML_FILES,
    contentVersion,
    deployVersion,
    stampAssetUrl,
    stampHtml,
    versionForHtmlFile,
} from '../scripts/stamp-asset-versions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('stampAssetUrl versions local css and js and leaves remote urls alone', () => {
    assert.equal(stampAssetUrl('styles.css', 'abc1234567'), 'styles.css?v=abc1234567');
    assert.equal(stampAssetUrl('../shared/theme.css?v=old', 'abc1234567'), '../shared/theme.css?v=abc1234567');
    assert.equal(
        stampAssetUrl('https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css', 'abc'),
        'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css'
    );
    assert.equal(
        stampAssetUrl('https://telegram.org/js/telegram-web-app.js', 'abc'),
        'https://telegram.org/js/telegram-web-app.js'
    );
    assert.equal(stampAssetUrl('shared/ai-chat.js', 'abc1234567'), 'shared/ai-chat.js?v=abc1234567');
});

test('stampHtml is idempotent and keeps non-asset attributes', () => {
    const html = '<script src="shared/ai-chat.js" defer></script>\n<link rel="stylesheet" href="styles.css">';
    const once = stampHtml(html, () => 'abc1234567');
    const twice = stampHtml(once, () => 'abc1234567');
    assert.equal(once, twice);
    assert.match(once, /src="shared\/ai-chat\.js\?v=abc1234567" defer/);
    assert.match(once, /href="styles\.css\?v=abc1234567"/);
});

test('deploy version is the short commit ref', () => {
    assert.equal(deployVersion({ COMMIT_REF: 'ABCDEF1234567890' }), 'abcdef1');
    assert.equal(deployVersion({}), null);
});

test('a Netlify publish rewrites every existing asset to the deploy commit', () => {
    const file = 'intake/index.html';
    const html = readFileSync(path.join(root, file), 'utf8');
    const stamped = stampHtml(html, versionForHtmlFile(file, {
        NETLIFY: 'true',
        COMMIT_REF: '0123456789abcdef',
    }));
    assert.match(stamped, /href="styles\.css\?v=0123456"/);
    assert.match(stamped, /href="\.\.\/shared\/theme\.css\?v=0123456"/);
    assert.match(stamped, /href="\.\.\/shared\/id-scan\.css\?v=0123456"/);
    assert.match(stamped, /src="\.\.\/shared\/brand\.js\?v=0123456"/);
    assert.match(stamped, /src="\.\.\/shared\/id-scan\.js\?v=0123456"/);
    assert.match(stamped, /src="app\.js\?v=0123456"/);
    assert.match(stamped, /unpkg\.com\/@phosphor-icons\/web@2\.1\.1\/src\/regular\/style\.css"/);
    assert.doesNotMatch(stamped, /unpkg\.com[^"']*\?v=/);
    assert.doesNotMatch(stamped, /telegram\.org[^"']*\?v=/);
});

test('mini-app html cache-busts first-party css and js with a content hash', () => {
    assert.ok(HTML_FILES.includes('intake/index.html'));
    assert.ok(HTML_FILES.includes('defendant/index.html'));
    assert.ok(HTML_FILES.includes('index.html'));

    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.postinstall, /stamp-asset-versions\.mjs/);
    assert.match(pkg.scripts['stamp-assets'], /stamp-asset-versions\.mjs --write/);

    for (const file of HTML_FILES) {
        const html = readFileSync(path.join(root, file), 'utf8');
        const expected = stampHtml(html, versionForHtmlFile(file, {}));
        assert.equal(html, expected, `${file} is missing a current ?v= content hash`);

        const tags = html.match(/<(?:link|script)\b[^>]*>/gi) || [];
        for (const tag of tags) {
            const url = /\b(?:href|src)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
            if (!url) continue;
            const remote = /^(?:[a-z]+:)?\/\//i.test(url);
            const asset = /\.(?:css|js)(?:\?|#|$)/i.test(url);
            if (remote) {
                assert.doesNotMatch(url, /[?&]v=/, `${file} should not version ${url}`);
                continue;
            }
            if (!asset) continue;
            const abs = path.resolve(path.dirname(path.join(root, file)), url.split('?')[0].split('#')[0]);
            if (!existsSync(abs)) {
                assert.doesNotMatch(url, /[?&]v=/, `${file} missing asset should stay unversioned: ${url}`);
                continue;
            }
            const version = /[?&]v=([0-9a-f]{10})(?:&|#|$)/.exec(url)?.[1];
            assert.ok(version, `${file} asset is not cache-busted: ${url}`);
            assert.equal(version, contentVersion(readFileSync(abs)), `${file} ${url}`);
        }
    }
});
