/**
 * Daily Briefing — Morning Staff AI Briefing + Forfeiture Clock
 * Cron: 0 12 * * * (7 AM ET = 12 PM UTC)
 *
 * AI-generated morning briefing of all active cases and tasks,
 * PLUS a real-time Forfeiture Countdown section showing bonds
 * at risk of forfeiture, sorted by highest financial exposure.
 */
import { getOpenAI, GAS_ENDPOINT } from './shared/ai-client.mjs';

export default async () => {
    console.log('[daily-briefing] Generating morning briefing...');

    try {
        // 1. Fetch active cases and stats from GAS
        const [statsResponse, forfeitureResponse] = await Promise.all([
            fetch(GAS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'get_daily_stats' }),
                redirect: 'follow',
            }),
            fetch(GAS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'get_forfeiture_cases' }),
                redirect: 'follow',
            }),
        ]);

        let data;
        try {
            data = await statsResponse.json();
        } catch {
            console.log('[daily-briefing] No JSON response from GAS');
            data = {};
        }

        // 2. Parse forfeiture data (graceful if endpoint not wired yet)
        let forfeitureData = { cases: [] };
        try {
            forfeitureData = await forfeitureResponse.json();
        } catch {
            console.log('[daily-briefing] Forfeiture endpoint not ready — skipping');
        }

        // 3. Build forfeiture clock section for the AI prompt
        let forfeitureContext = '';
        if (forfeitureData?.cases && forfeitureData.cases.length > 0) {
            // Sort by days remaining (most urgent first)
            const sorted = forfeitureData.cases.sort((a, b) => (a.daysRemaining || 999) - (b.daysRemaining || 999));
            const lines = sorted.map(c => {
                const emoji = c.daysRemaining <= 7 ? '🔴' : c.daysRemaining <= 21 ? '🟡' : '🟢';
                return `${emoji} ${c.defendantName} — $${Number(c.bondAmount || 0).toLocaleString()} bond — ${c.daysRemaining} days remaining (Case: ${c.caseNumber})`;
            });
            forfeitureContext = `\n\nFORFEITURE CLOCK DATA (Active forfeitures):\n${lines.join('\n')}`;
        }

        // 4. Generate AI briefing
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

⏰ **Forfeiture Countdown** (ONLY include if forfeiture data is provided)
- List each forfeiture case with 🔴/🟡/🟢 urgency
- 🔴 = 7 days or less (CRITICAL — action required TODAY)
- 🟡 = 8-21 days (needs attention this week)
- 🟢 = 22+ days (monitoring)
- Sort by most urgent first
- Include bond amount and days remaining
- If no forfeiture data, omit this section entirely

Keep it motivational. End with a short inspirational note. Use Slack emoji and formatting.`,
                },
                {
                    role: 'user',
                    content: `Generate today's briefing from this data:\n\n${JSON.stringify(data, null, 2)}${forfeitureContext}`,
                },
            ],
            max_tokens: 1000,
            temperature: 0.6,
        });

        const briefing = completion.choices[0]?.message?.content || 'No briefing generated';

        // 5. Post to Slack via GAS
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

        const forfeitureCount = forfeitureData?.cases?.length || 0;
        console.log(`[daily-briefing] Briefing posted to Slack (${forfeitureCount} forfeiture case(s) included)`);
        return new Response(`Briefing posted (${forfeitureCount} forfeitures)`, { status: 200 });
    } catch (err) {
        console.error('[daily-briefing] Error:', err.message);
        return new Response('Error: ' + err.message, { status: 500 });
    }
};

export const config = {
    schedule: '0 12 * * *',
};
