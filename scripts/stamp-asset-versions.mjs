/**
 * Cache-bust first-party CSS/JS linked from the mini-app HTML.
 *
 * netlify.toml serves *.css and *.js with Cache-Control: max-age=3600, and
 * HTML revalidates. A returning browser can keep yesterday's stylesheet for
 * up to an hour after a deploy. A ?v= query changes the URL so that fetch is fresh.
 *
 * Local / CI (`npm run build`): ?v= is a short content hash of each file.
 * Netlify (`NETLIFY=true` during `npm install` → postinstall): ?v= is the
 * deploy commit, so every publish busts CSS/JS even when this script is the
 * only rewrite. Cache headers in netlify.toml stay as they are.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HTML_FILES = [
    'index.html',
    'intake/index.html',
    'defendant/index.html',
    'documents/index.html',
    'payment/index.html',
    'paperwork/index.html',
    'status/index.html',
    'updates/index.html',
];

const TAG_RE = /<(link|script)\b[^>]*>/gi;
const URL_RE = /\b(href|src)\s*=\s*(["'])([^"']+)\2/i;

export function contentVersion(bytes) {
    return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

export function deployVersion(env = process.env) {
    const ref = env.COMMIT_REF || '';
    if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref.slice(0, 7).toLowerCase();
    return null;
}

export function stampAssetUrl(url, version) {
    if (/^(?:[a-z]+:)?\/\//i.test(url)) return url;
    const hashAt = url.indexOf('#');
    const hash = hashAt >= 0 ? url.slice(hashAt) : '';
    const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
    const qAt = beforeHash.indexOf('?');
    const pathname = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
    if (!/\.(?:css|js)$/i.test(pathname)) return url;
    const params = new URLSearchParams(qAt >= 0 ? beforeHash.slice(qAt + 1) : '');
    params.set('v', version);
    return `${pathname}?${params.toString()}${hash}`;
}

export function stampHtml(html, versionForUrl) {
    return html.replace(TAG_RE, (tag) => {
        const match = URL_RE.exec(tag);
        if (!match) return tag;
        const [, attr, quote, url] = match;
        if (/^(?:[a-z]+:)?\/\//i.test(url)) return tag;
        const pathname = url.split('#')[0].split('?')[0];
        if (!/\.(?:css|js)$/i.test(pathname)) return tag;
        const version = versionForUrl(url);
        if (!version) return tag;
        const stamped = stampAssetUrl(url, version);
        return tag.replace(URL_RE, `${attr}=${quote}${stamped}${quote}`);
    });
}

export function versionForHtmlFile(htmlFile, env = process.env) {
    const deploy = env.NETLIFY === 'true' ? deployVersion(env) : null;
    const htmlDir = path.dirname(path.join(root, htmlFile));
    return (url) => {
        const pathname = url.split('#')[0].split('?')[0];
        const abs = path.resolve(htmlDir, pathname);
        if (!existsSync(abs)) return null;
        if (deploy) return deploy;
        return contentVersion(readFileSync(abs));
    };
}

export function stampFile(htmlFile, env = process.env) {
    const abs = path.join(root, htmlFile);
    const before = readFileSync(abs, 'utf8');
    const after = stampHtml(before, versionForHtmlFile(htmlFile, env));
    if (after !== before) writeFileSync(abs, after);
    return after !== before;
}

function isCli() {
    const entry = process.argv[1];
    return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
    const write = process.argv.includes('--write') || process.env.NETLIFY === 'true';
    if (!write) {
        console.log('asset version stamp skipped (pass --write, or build on Netlify)');
        process.exit(0);
    }
    const mode = process.env.NETLIFY === 'true' && deployVersion() ? 'deploy' : 'content';
    let changed = 0;
    for (const file of HTML_FILES) {
        if (stampFile(file)) changed += 1;
    }
    console.log(`asset version stamp (${mode}) updated ${changed} html file(s)`);
}
