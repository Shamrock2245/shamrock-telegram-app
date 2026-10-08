import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function channel(hex, index) {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
    return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

function contrast(foreground, background) {
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
}

function mix(start, end, amount) {
    const channels = [0, 1, 2].map((index) => {
        const from = parseInt(start.slice(1 + index * 2, 3 + index * 2), 16);
        const to = parseInt(end.slice(1 + index * 2, 3 + index * 2), 16);
        return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0');
    });
    return `#${channels.join('')}`;
}

const css = readFileSync(new URL('../shared/id-scan.css', import.meta.url), 'utf8');
const intakeCss = readFileSync(new URL('../intake/styles.css', import.meta.url), 'utf8');

function primaryRule() {
    const block = css.match(/label\.id-scan-btn-primary,[\s\S]*?\}/);
    assert.ok(block, 'primary take-photo rule missing');
    return block[0];
}

test('take-photo label clears 4.5:1 on both shamrock gradient stops', () => {
    const rule = primaryRule();
    assert.match(rule, /\.form-group label\.id-scan-btn-primary/);
    assert.match(rule, /upload-group label\.id-scan-btn-primary/);

    const foreground = /color:\s*(#[0-9a-f]{6})/i.exec(rule)?.[1].toLowerCase();
    const gradient = /linear-gradient\(\s*135deg\s*,\s*(#[0-9a-f]{6})\s+0%\s*,\s*(#[0-9a-f]{6})\s+100%\s*\)/i.exec(rule);
    assert.ok(foreground, rule);
    assert.ok(gradient, rule);
    const start = gradient[1].toLowerCase();
    const end = gradient[2].toLowerCase();

    assert.equal(start, '#10b981');
    assert.equal(end, '#059669');

    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
        const background = mix(start, end, amount);
        const ratio = contrast(foreground, background);
        assert.ok(ratio >= 4.5, `${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
    }
});

test('choose-file stays off the green face and clears 4.5:1 in light theme', () => {
    const fileRule = css.match(/\.id-scan-btn-file\s*\{[\s\S]*?\}/);
    assert.ok(fileRule, 'choose-file rule missing');
    assert.match(fileRule[0], /background:\s*transparent/);
    assert.doesNotMatch(fileRule[0], /linear-gradient/);

    const light = intakeCss.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
    assert.ok(light, 'intake light theme tokens missing');
    const secondary = /--text-secondary:\s*(#[0-9a-f]{6})/i.exec(light[1])?.[1].toLowerCase();
    const page = /--bg-body:\s*(#[0-9a-f]{6})/i.exec(light[1])?.[1].toLowerCase();
    assert.ok(secondary && page);

    // `.form-group label` outranks `.id-scan-btn-file`, so intake paints this slate
    // on the near-white card. That pair already clears WCAG AA for 16px text.
    for (const background of ['#ffffff', page]) {
        const ratio = contrast(secondary, background);
        assert.ok(ratio >= 4.5, `${secondary} on ${background} is ${ratio.toFixed(2)}:1`);
    }
});
