/**
 * Office parallel-ring targets for every live-person Dial.
 * First number to answer wins. Spoken office number stays 239-332-2245.
 * Never add +17272952245 (Shannon's own line) to this list.
 *
 * Order is the Dial order:
 *   +12393322245  239-332-2245 office landline
 *   +12399550301  239-955-0301
 *   +12399550178  239-955-0178 (BlueBubbles text line; still rung)
 *   +12399550314  239-955-0314
 */

export const OFFICE_RING_TARGETS = Object.freeze([
    '+12393322245',
    '+12399550301',
    '+12399550178',
    '+12399550314',
]);

export const SHANNON_LINE = '+17272952245';

export const OFFICE_RING_SECONDS = 25;

function nationalDigits(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return digits;
}

if (
    OFFICE_RING_TARGETS.length !== 4 ||
    OFFICE_RING_TARGETS.some((number) => number === SHANNON_LINE || nationalDigits(number) === '7272952245')
) {
    throw new Error('office_ring_includes_shannon');
}

export function isOfficeRingTarget(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return false;
    return OFFICE_RING_TARGETS.some((target) => {
        const national = nationalDigits(target);
        return digits === '1' + national || digits === national || digits.endsWith(national);
    });
}

export function officeRingNumbersXml() {
    return OFFICE_RING_TARGETS.map((number) => `<Number>${number}</Number>`).join('');
}
