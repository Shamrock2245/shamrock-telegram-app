/**
 * Engagement Watchdog — Scheduled Function (Every 2 Hours)
 * Cron: 0 */2 * * *
 *
 * Monitors court date reminder acknowledgments.If a defendant has NOT
    * acknowledged their court reminder within 12 hours of their hearing,
 * escalates to the co - signer(indemnitor) and alerts staff on Slack.
 *
 * This is the #1 ROI risk mitigation feature — FTA(Failure to Appear)
    * is the single biggest financial risk in bail bonds.
 *
 * Flow:
 * 1. Fetch unacknowledged court reminders from GAS
    * 2. Filter to those within 12hrs of hearing
        * 3. For each: escalate to co - signer via SMS + post Slack alert
            * 4. Mark case as "High Flight Risk" in GAS tracker
                */
import { GAS_ENDPOINT } from './shared/ai-client.mjs';

export default async () => {
    console.log('[engagement-watchdog] Checking for unacknowledged court reminders...');

    try {
        // 1. Fetch reminders that haven't been acknowledged
        const gasResponse = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'get_unacknowledged_reminders', hoursUntilCourt: 24 }),
            redirect: 'follow',
        });

        let data;
        try {
            data = await gasResponse.json();
        } catch {
            console.log('[engagement-watchdog] No JSON response from GAS — endpoint may not exist yet');
            return new Response('GAS endpoint not ready', { status: 200 });
        }

        if (!data?.cases || data.cases.length === 0) {
            console.log('[engagement-watchdog] All reminders acknowledged ✓');
            return new Response('No unacknowledged reminders', { status: 200 });
        }

        console.log(`[engagement-watchdog] Found ${data.cases.length} unacknowledged reminder(s)`);

        // 2. Escalate each unacknowledged case
        const escalations = [];

        for (const caseItem of data.cases) {
            const hoursUntil = caseItem.hoursUntilCourt || 0;
            const urgency = hoursUntil <= 6 ? 'CRITICAL' : hoursUntil <= 12 ? 'HIGH' : 'MEDIUM';
            const emoji = hoursUntil <= 6 ? '🔴' : hoursUntil <= 12 ? '🟠' : '🟡';

            // Build Slack alert message
            const slackMessage = [
                `${emoji} *ENGAGEMENT ALERT — ${urgency}*`,
                ``,
                `*Defendant:* ${caseItem.defendantName || 'Unknown'}`,
                `*Case:* ${caseItem.caseNumber || 'N/A'}`,
                `*Court Date:* ${caseItem.courtDate || 'Unknown'} at ${caseItem.courtTime || 'Unknown'}`,
                `*Location:* ${caseItem.courtLocation || 'Unknown'}`,
                `*Reminder Sent:* ${caseItem.reminderSentAt || 'Unknown'}`,
                `*Hours Until Court:* ${hoursUntil}`,
                `*Status:* ⚠️ Defendant has NOT acknowledged court reminder`,
                ``,
                `*Action Taken:* ${caseItem.cosignerPhone ? '📱 SMS sent to co-signer' : '⚠️ No co-signer phone on file'}`,
            ].join('\n');

            // Build co-signer SMS
            const cosignerSMS = caseItem.cosignerPhone
                ? `Shamrock Bail Bonds ALERT: ${caseItem.defendantName} has not confirmed their court date on ${caseItem.courtDate}. As co-signer, please ensure they appear. Questions? (239) 332-2245`
                : null;

            escalations.push({
                caseNumber: caseItem.caseNumber,
                defendantName: caseItem.defendantName,
                cosignerPhone: caseItem.cosignerPhone,
                cosignerName: caseItem.cosignerName,
                cosignerSMS,
                slackMessage,
                urgency,
                hoursUntilCourt: hoursUntil,
            });
        }

        // 3. Send escalations back to GAS for delivery
        if (escalations.length > 0) {
            await fetch(GAS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'escalate_to_cosigner',
                    escalations,
                    timestamp: new Date().toISOString(),
                }),
                redirect: 'follow',
            });
        }

        const summary = `Escalated ${escalations.length} case(s): ${escalations.map(e => `${e.caseNumber}[${e.urgency}]`).join(', ')}`;
        console.log(`[engagement-watchdog] ${summary}`);
        return new Response(summary, { status: 200 });
    } catch (err) {
        console.error('[engagement-watchdog] Error:', err.message);
        return new Response('Error: ' + err.message, { status: 500 });
    }
};

export const config = {
    schedule: '0 */2 * * *',
};
