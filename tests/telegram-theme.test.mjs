import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const brandSrc = fs.readFileSync(new URL('../shared/brand.js', import.meta.url), 'utf8');

function loadBrand(telegram, saved) {
    const styles = new Map();
    const attrs = new Map();
    const store = new Map(Object.entries(saved || {}));
    const bodyClasses = new Set();
    const html = {
        style: {
            setProperty(name, value) { styles.set(name, String(value)); },
            getPropertyValue(name) { return styles.get(name) || ''; }
        },
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        removeAttribute(name) { attrs.delete(name); }
    };
    const context = {
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        navigator: {},
        localStorage: {
            getItem(key) { return store.has(key) ? store.get(key) : null; },
            setItem(key, value) { store.set(key, String(value)); }
        },
        sessionStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        document: {
            documentElement: html,
            body: {
                classList: {
                    add(name) { bodyClasses.add(name); },
                    remove(name) { bodyClasses.delete(name); }
                }
            }
        }
    };
    context.window = telegram ? { Telegram: { WebApp: telegram } } : {};
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(brandSrc, context);
    return { context, styles, attrs, store, bodyClasses };
}

function telegramApp(overrides) {
    const events = {};
    const calls = [];
    const app = Object.assign({
        colorScheme: 'light',
        themeParams: {
            bg_color: '#ffffff',
            secondary_bg_color: '#f1f1f1',
            text_color: '#111111',
            hint_color: '#707579',
            link_color: '#2481cc',
            button_color: '#2481cc',
            button_text_color: '#ffffff',
            header_bg_color: '#ffffff',
            bottom_bar_bg_color: '#f1f1f1',
            section_separator_color: '#e7e7e7'
        },
        onEvent(name, fn) { events[name] = fn; },
        setBackgroundColor(color) { calls.push(['bg', color]); },
        setHeaderColor(color) { calls.push(['header', color]); },
        setBottomBarColor(color) { calls.push(['bottom', color]); }
    }, overrides || {});
    app.events = events;
    app.calls = calls;
    return app;
}

test('browser with an empty WebApp stub keeps the light/dark toggle', () => {
    const stub = { colorScheme: 'light', themeParams: {}, platform: 'unknown' };
    const { context, attrs, store, styles } = loadBrand(stub, { 'shamrock-theme': 'light' });
    context.initTheme();
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(attrs.get('data-tg-theme'), undefined);
    assert.equal(styles.has('--tg-button-color'), false);
    context.toggleTheme();
    assert.equal(attrs.get('data-theme'), 'dark');
    assert.equal(store.get('shamrock-theme'), 'dark');
    context.toggleTheme();
    assert.equal(attrs.get('data-theme'), 'light');
});

test('missing WebApp defaults to dark and the toggle still works', () => {
    const { context, attrs, store } = loadBrand(null, {});
    context.initTheme();
    assert.equal(attrs.get('data-theme'), 'dark');
    context.toggleTheme();
    assert.equal(store.get('shamrock-theme'), 'light');
});

test('themeParams set scheme, background, text, and button colors', () => {
    const app = telegramApp();
    app.setHeaderColor = function () { throw new Error('header rejected'); };
    const { context, attrs, styles, store, bodyClasses } = loadBrand(app, { 'shamrock-theme': 'dark' });
    context.initTheme();
    assert.equal(attrs.get('data-tg-theme'), '1');
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(styles.get('--bg-body'), '#ffffff');
    assert.equal(styles.get('--bg-primary'), '#ffffff');
    assert.equal(styles.get('--text-primary'), '#111111');
    assert.equal(styles.get('--text-muted'), '#707579');
    assert.equal(styles.get('--tg-button-color'), '#2481cc');
    assert.equal(styles.get('--green-primary'), '#2481cc');
    assert.equal(styles.get('--gradient-brand'), '#2481cc');
    assert.equal(styles.get('--tg-button-text-color'), '#ffffff');
    assert.equal(styles.get('--tg-link-color'), '#2481cc');
    assert.equal(styles.get('color-scheme'), 'light');
    assert.equal(bodyClasses.has('tg-themed'), true);
    assert.equal(store.get('shamrock-theme'), 'dark');
    assert.deepEqual(app.calls.filter(function (call) { return call[0] === 'bg'; }), [['bg', '#ffffff']]);
    context.toggleTheme();
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(store.get('shamrock-theme'), 'dark');
});

test('themeChanged reapplies colors and a dark background follows colorScheme', () => {
    const app = telegramApp({ colorScheme: 'dark' });
    app.themeParams.bg_color = '#1c1c1d';
    app.themeParams.text_color = '#ffffff';
    const { context, attrs, styles } = loadBrand(app, {});
    context.initTheme();
    assert.equal(attrs.get('data-theme'), 'dark');
    assert.equal(styles.get('--bg-body'), '#1c1c1d');
    app.colorScheme = 'light';
    app.themeParams.bg_color = '#ffffff';
    app.themeParams.button_color = '#3390ec';
    app.events.themeChanged();
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(styles.get('--bg-body'), '#ffffff');
    assert.equal(styles.get('--green-primary'), '#3390ec');
    app.events.themeChanged();
    assert.equal(typeof app.events.themeChanged, 'function');
});

test('without colorScheme, background luminance picks light or dark', () => {
    const { context, attrs } = loadBrand(telegramApp({ colorScheme: undefined, themeParams: { bg_color: '#111111', text_color: '#fff', button_color: '#2481cc' } }), {});
    context.initTheme();
    assert.equal(attrs.get('data-theme'), 'dark');
});

test('theme work does not move the mini-app proxy or identity checks', () => {
    assert.match(brandSrc, /const SHAMROCK_MINIAPP_API = '\/api\/miniapp'/);
    assert.match(brandSrc, /initData: tgInitData/);
    assert.match(brandSrc, /function miniappLookup\(action, phone\)/);
    assert.match(brandSrc, /function getVerifiedContact\(\)/);
    assert.doesNotMatch(brandSrc, /script\.google\.com/);
});

test('intake boots theme from the shared helper and names the five existing steps', () => {
    const html = fs.readFileSync(new URL('../intake/index.html', import.meta.url), 'utf8');
    const app = fs.readFileSync(new URL('../intake/app.js', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../intake/styles.css', import.meta.url), 'utf8');
    assert.match(html, /<script src="\.\.\/shared\/brand\.js(?:\?v=[0-9a-f]{7,40})?"><\/script>\s*<script>initTheme\(\);<\/script>/);
    assert.match(html, /data-name="Who needs bail\?"/);
    assert.match(html, /data-name="Your Information"/);
    assert.match(html, /data-name="Employment &amp; References"/);
    assert.match(html, /data-name="Documents &amp; Location"/);
    assert.match(html, /data-name="Review &amp; Submit"/);
    assert.match(app, /initTheme\(\)/);
    assert.doesNotMatch(app, /classList\.add\('tg-themed'\)/);
    assert.match(css, /min-height:\s*48px/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /font-size:\s*16px;\s*\n\s*\/\* 16px keeps iOS/);
    const themeCss = fs.readFileSync(new URL('../shared/theme.css', import.meta.url), 'utf8');
    assert.match(themeCss, /html\[data-tg-theme="1"\] \.theme-toggle/);
});
