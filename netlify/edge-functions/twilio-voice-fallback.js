/**
 * Twilio Voice fallback if the primary Shannon webhook is down.
 * Console: Phone number → Voice → Primary failover / fallback URL.
 * Always rings the Fort Myers office. Never dials 727 (Shannon's own number).
 */
const OFFICE_LINE = '+12393322245';
const TWILIO_NUMBER = '+17272952245';

export default async () => {
    const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Dial timeout="25" callerId="${TWILIO_NUMBER}" answerOnBridge="true">` +
        `<Number>${OFFICE_LINE}</Number>` +
        '</Dial>' +
        '<Say>We are unable to connect your call right now. Please call two three nine, three three two, two two four five.</Say>' +
        '</Response>';
    return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
    });
};
