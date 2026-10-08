import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyIdPhoto } from '../shared/id-scan.js';

const ANY_US_ID = /driver's license, state ID, or passport/i;

test('classifyIdPhoto gives UI-only front and back feedback', () => {
    assert.equal(classifyIdPhoto(null, null, 'front').state, 'error');

    const pdf = classifyIdPhoto({ type: 'application/pdf', size: 1200 }, null, 'front');
    assert.equal(pdf.state, 'error');
    assert.match(pdf.message, ANY_US_ID);
    assert.doesNotMatch(pdf.message, /florida/i);

    const empty = classifyIdPhoto({ type: 'image/jpeg', size: 0 }, { width: 1000, height: 600 }, 'front');
    assert.equal(empty.state, 'error');
    assert.match(empty.message, /empty/i);

    const broken = classifyIdPhoto({ type: 'image/jpeg', size: 4000 }, null, 'back');
    assert.equal(broken.state, 'error');
    assert.match(broken.message, /couldn't open/i);

    const tiny = classifyIdPhoto({ type: 'image/jpeg', size: 4000 }, { width: 320, height: 200 }, 'front');
    assert.equal(tiny.state, 'warn');
    assert.match(tiny.message, /still continue/i);

    const skinny = classifyIdPhoto({ type: 'image/png', size: 8000 }, { width: 2400, height: 600 }, 'back');
    assert.equal(skinny.state, 'warn');
    assert.match(skinny.message, /unusual shape/i);

    const front = classifyIdPhoto({ type: 'image/jpeg', size: 90000 }, { width: 1600, height: 1000 }, 'front');
    assert.equal(front.state, 'success');
    assert.equal(front.status, 'Saved');
    assert.match(front.message, /Front photo saved/);

    const back = classifyIdPhoto({ type: 'image/jpeg', size: 90000 }, { width: 1000, height: 700 }, 'back');
    assert.equal(back.state, 'success');
    assert.match(back.message, /Back photo saved/);
    assert.match(back.message, /barcode/i);
});

function idCaptureBlock(file) {
    const html = readFileSync(file, 'utf8');
    const start = html.indexOf('id="idFrontUpload"');
    const endMarker = html.includes('id="locationBtn"') ? 'id="locationBtn"' : 'id="supportDocs"';
    const end = html.indexOf(endMarker);
    assert.ok(start > -1 && end > start, file + ' is missing the ID viewfinder block');
    return html.slice(start, end);
}

test('intake and defendant ID capture keep camera capture, file fallback, and any-US-state copy', () => {
    for (const file of ['intake/index.html', 'defendant/index.html']) {
        const block = idCaptureBlock(file);
        assert.equal((block.match(/capture="environment"/g) || []).length, 2, file);
        assert.equal((block.match(/data-relay="/g) || []).length, 2, file);
        assert.match(block, ANY_US_ID);
        assert.doesNotMatch(block, /florida/i);
        assert.match(block, /id="idFront"/);
        assert.match(block, /id="idBack"/);
    }
});
