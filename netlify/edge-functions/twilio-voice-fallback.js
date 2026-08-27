/**
 * Twilio Voice fallback if the primary Shannon webhook is down.
 * Console: Phone number → Voice → Primary failover / fallback URL.
 * Rings 239-955-0301 first, then 239-332-2245. Never dials 727.
 */
const DESK_LINE = '+12399550301';
const NAP_LINE = '+12393322245';
const TWILIO_NUMBER = '+17272952245';

export default async () => {
    const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Dial timeout="25" callerId="${TWILIO_NUMBER}" answerOnBridge="true">` +
        `<Number>${DESK_LINE}</Number>` +
        '</Dial>' +
        `<Dial timeout="25" callerId="${TWILIO_NUMBER}" answerOnBridge="true">` +
        `<Number>${NAP_LINE}</Number>` +
        '</Dial>' +
        '<Say>We are unable to connect your call right now. Please call two three nine, nine five five, zero three zero one, or two three nine, three three two, two two four five.</Say>' +
        '</Response>';
    return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
    });
};
