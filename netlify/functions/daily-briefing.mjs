/**
 * Daily Briefing — Morning Staff AI Briefing
 * Cron: 0 12 * * * (7 AM ET = 12 PM UTC)
 *
 * AI-generated morning briefing of all active cases and tasks.
 */
import { Config } from '@netlify/functions';
import { getOpenAI, GAS_ENDPOINT } from './shared/ai-client.mjs';

export default async () => {
    console.log('[daily-briefing] Generating morning briefing...');

    try {
        // 1. Fetch active cases and stats from GAS
        const gasResponse = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'get_daily_stats' }),
            redirect: 'follow',
        });

        let data;
        try {
            data = await gasResponse.json();
        } catch {
            console.log('[daily-briefing] No JSON response from GAS');
            return new Response('No stats data', { status: 200 });
        }

        // 2. Generate AI briefing
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are the operations manager for Shamrock Bail Bonds. Generate a morning Slack briefing. Include:

☀️ **Good Morning, Shamrock Team!** 
Today is [date]. Here's your daily briefing:

📈 **By the Numbers**
- Active bonds, new intakes yesterday, pending signatures, revenue

⚖️ **Today's Court Dates**
- List defendants with court appearances today

🔔 **Priority Actions**
- Numbered list of items needing attention today

💰 **Collections**
- Payments due today, overdue amounts

Keep it motivational. End with a short inspirational note. Use Slack emoji and formatting.`,
                },
                {
                    role: 'user',
                    content: `Generate today's briefing from this data:\n\n${JSON.stringify(data, null, 2)}`,
                },
            ],
            max_tokens: 800,
            temperature: 0.6,
        });

        const briefing = completion.choices[0]?.message?.content || 'No briefing generated';

        // 3. Post to Slack via GAS
        await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'post_slack_message',
                channel: '#general',
                message: briefing,
            }),
            redirect: 'follow',
        });

        console.log('[daily-briefing] Briefing posted to Slack');
        return new Response('Briefing posted', { status: 200 });
    } catch (err) {
        console.error('[daily-briefing] Error:', err.message);
        return new Response('Error: ' + err.message, { status: 500 });
    }
};

export const config = {
    schedule: '0 12 * * *',
};
