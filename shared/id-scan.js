/**
 * ID capture viewfinder — UI states only.
 * Does not read the card, call OCR, or change what gets uploaded.
 * The camera input keeps capture="environment"; a second input is the file fallback.
 */

var MIN_SHORT_SIDE = 480;
var MIN_RATIO = 1.15;
var MAX_RATIO = 2.45;

export function classifyIdPhoto(file, dims, side) {
    var which = side === 'back' ? 'back' : 'front';
    if (!file) {
        return {
            state: 'error',
            status: 'Try again',
            message: 'Choose a photo of a driver\'s license, state ID, or passport.'
        };
    }
    if (!/^image\//i.test(String(file.type || ''))) {
        return {
            state: 'error',
            status: 'Try again',
            message: 'That file is not a photo. Take a picture or choose an image of a driver\'s license, state ID, or passport.'
        };
    }
    if (!file.size) {
        return {
            state: 'error',
            status: 'Try again',
            message: 'That file is empty. Take the photo again.'
        };
    }
    var width = dims && Number(dims.width);
    var height = dims && Number(dims.height);
    if (!width || !height) {
        return {
            state: 'error',
            status: 'Try again',
            message: 'We couldn\'t open that photo. Take it again or choose a different image.'
        };
    }
    var shortSide = Math.min(width, height);
    var ratio = Math.max(width, height) / shortSide;
    if (shortSide < MIN_SHORT_SIDE) {
        return {
            state: 'warn',
            status: 'Retake',
            message: 'This photo is very small. Move closer so the card fills the frame, then retake. You can still continue with this one.'
        };
    }
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
        return {
            state: 'warn',
            status: 'Retake',
            message: 'This photo is an unusual shape. Retake with the whole card inside the frame. You can still continue with this one.'
        };
    }
    return {
        state: 'success',
        status: 'Saved',
        message: which === 'back'
            ? 'Back photo saved. Retake it if the barcode is cut off.'
            : 'Front photo saved. Retake it if the text is blurry or a corner is cut off.'
    };
}

function scanSide(root) {
    return root && root.getAttribute('data-side') === 'back' ? 'back' : 'front';
}

function setScanState(root, state) {
    ['is-idle', 'is-checking', 'is-success', 'is-warn', 'is-error'].forEach(function (cls) {
        root.classList.remove(cls);
    });
    root.classList.add(state === 'idle' ? 'is-idle' : 'is-' + state);
}

function setScanText(root, selector, text) {
    var el = root.querySelector(selector);
    if (el) el.textContent = text;
}

function measureImage(file) {
    return new Promise(function (resolve) {
        if (!file || !/^image\//i.test(String(file.type || '')) || !file.size || typeof URL === 'undefined') {
            resolve(null);
            return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
            URL.revokeObjectURL(url);
        };
        img.onerror = function () {
            resolve(null);
            URL.revokeObjectURL(url);
        };
        img.src = url;
    });
}

function hapticFor(state) {
    try {
        var tg = window.Telegram && window.Telegram.WebApp;
        if (!tg || !tg.HapticFeedback || !tg.HapticFeedback.notificationOccurred) return;
        var kind = state === 'success' ? 'success' : state === 'warn' ? 'warning' : state === 'error' ? 'error' : '';
        if (kind) tg.HapticFeedback.notificationOccurred(kind);
    } catch (err) {
        /* Telegram builds differ; the status text is the feedback that matters. */
    }
}

export function paintIdScan(root, file) {
    if (!root) return Promise.resolve(null);
    var seq = String(Date.now()) + Math.random();
    root.dataset.scanSeq = seq;
    setScanState(root, 'checking');
    setScanText(root, '.id-scan-status', 'Checking…');
    setScanText(root, '.id-scan-feedback', 'Checking the photo…');

    return measureImage(file).then(function (dims) {
        if (root.dataset.scanSeq !== seq) return null;
        var result = classifyIdPhoto(file, dims, scanSide(root));
        setScanState(root, result.state);
        setScanText(root, '.id-scan-status', result.status);
        setScanText(root, '.id-scan-feedback', result.message);
        var label = root.querySelector('.id-scan-btn-label');
        if (label) {
            var retake = label.getAttribute('data-retake');
            var idle = label.getAttribute('data-idle');
            label.textContent = (result.state === 'idle' ? idle : retake) || label.textContent;
        }
        hapticFor(result.state);
        return result;
    });
}

export function relayIdFile(source, target) {
    var file = source && source.files && source.files[0];
    if (!file || !target) return false;
    var assigned = false;
    try {
        var dt = new DataTransfer();
        dt.items.add(file);
        target.files = dt.files;
        assigned = !!(target.files && target.files.length);
    } catch (err) {
        assigned = false;
    }
    source.value = '';
    if (!assigned) return false;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function bootIdScan() {
    document.querySelectorAll('input[data-relay]').forEach(function (input) {
        input.addEventListener('change', function () {
            var target = document.getElementById(input.getAttribute('data-relay'));
            relayIdFile(input, target);
        });
    });
    document.querySelectorAll('.id-scan').forEach(function (root) {
        var finder = root.querySelector('.id-scan-finder');
        var camera = root.querySelector('input[capture]');
        if (!finder || !camera) return;
        finder.addEventListener('click', function () {
            camera.click();
        });
    });
}

if (typeof window !== 'undefined') {
    window.shamrockPaintIdScan = paintIdScan;
    window.shamrockRelayIdFile = relayIdFile;
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootIdScan);
    else bootIdScan();
}
