/**
 * Court Reminder — Scheduled Function (Hourly)
 * Cron: @hourly
 *
 * Fetches upcoming court dates from GAS, generates AI-personalized
 * reminders, and triggers notifications via GAS.
 */
import { Config } from '@netlify/functions';
import { getOpenAI, GAS_ENDPOINT } from './shared/ai-client.mjs';

export default async () => {
    console.log('[court-reminder] Running scheduled check...');

    try {
        // 1. Fetch upcoming court dates from GAS
        const gasResponse = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'get_upcoming_court_dates', hoursAhead: 48 }),
            redirect: 'follow',
        });

        let data;
        try {
            data = await gasResponse.json();
        } catch {
            console.log('[court-reminder] No JSON response from GAS');
            return new Response('No upcoming dates', { status: 200 });
        }

        if (!data?.dates || data.dates.length === 0) {
            console.log('[court-reminder] No upcoming court dates');
            return new Response('No upcoming dates', { status: 200 });
        }

        // 2. Generate personalized reminders for each date
        const openai = getOpenAI();
        const reminders = [];

        for (const courtDate of data.dates) {
            try {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'Generate a brief, warm court date reminder. Include: date/time, location, and a note about appearing on time. Under 3 sentences. Return ONLY the reminder text.',
                        },
                        {
                            role: 'user',
                            content: `Reminder for ${courtDate.name}: Court date at ${courtDate.location} on ${courtDate.date} at ${courtDate.time}. Case: ${courtDate.caseNumber || 'N/A'}`,
                        },
                    ],
                    max_tokens: 200,
                    temperature: 0.5,
                });

                const message = completion.choices[0]?.message?.content || '';
                reminders.push({
                    phone: courtDate.phone,
                    name: courtDate.name,
                    message,
                    courtDate: courtDate.date,
                });
            } catch (aiErr) {
                console.warn(`[court-reminder] AI error for ${courtDate.name}:`, aiErr.message);
                // Fallback to template reminder
                reminders.push({
                    phone: courtDate.phone,
                    name: courtDate.name,
                    message: `Hi ${courtDate.name}, this is Shamrock Bail Bonds. Reminder: your court date is ${courtDate.date} at ${courtDate.time} at ${courtDate.location}. Please arrive 15 minutes early. Questions? Call (239) 332-2245.`,
                    courtDate: courtDate.date,
                });
            }
        }

        // 3. Send reminders back to GAS for delivery
        if (reminders.length > 0) {
            await fetch(GAS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'send_court_reminders', reminders }),
                redirect: 'follow',
            });
        }

        console.log(`[court-reminder] Sent ${reminders.length} reminders`);
        return new Response(`Sent ${reminders.length} reminders`, { status: 200 });
    } catch (err) {
        console.error('[court-reminder] Error:', err.message);
        return new Response('Error: ' + err.message, { status: 500 });
    }
};

export const config = {
    schedule: '@hourly',
};
