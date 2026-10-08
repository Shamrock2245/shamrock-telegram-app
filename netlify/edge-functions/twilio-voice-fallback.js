/**
 * Twilio Voice fallback if the primary Shannon webhook is down.
 * Console: Phone number → Voice → Primary failover / fallback URL.
 * Parallel-rings the four office lines; first answer wins.
 * +12393322245, +12399550301, +12399550178, +12399550314.
 * Never dials +17272952245.
 */
import {
    OFFICE_RING_SECONDS,
    SHANNON_LINE,
    officeRingNumbersXml,
} from '../../shared/office-ring-targets.js';

const TWILIO_NUMBER = SHANNON_LINE;

export function fallbackDialTwiml() {
    return '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Dial timeout="${OFFICE_RING_SECONDS}" callerId="${TWILIO_NUMBER}" answerOnBridge="true">` +
        officeRingNumbersXml() +
        '</Dial>' +
        '<Say>We are unable to connect your call right now. Please call two three nine, three three two, two two four five.</Say>' +
        '</Response>';
}

export default async () => {
    const twiml = fallbackDialTwiml();
    return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
    });
};
