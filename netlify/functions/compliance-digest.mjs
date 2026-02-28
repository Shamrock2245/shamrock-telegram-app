/**
 * Compliance Digest — Daily Staff Digest
 * Cron: 0 13 * * * (8 AM ET = 1 PM UTC)
 *
 * Fetches missed check-ins and compliance issues from GAS,
 * generates an AI summary, and posts to Slack.
 */
import { Config } from '@netlify/functions';
import { getOpenAI, GAS_ENDPOINT } from './shared/ai-client.mjs';

export default async () => {
    console.log('[compliance-digest] Generating daily digest...');

    try {
        // 1. Fetch compliance data from GAS
        const gasResponse = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'get_compliance_report' }),
            redirect: 'follow',
        });

        let data;
        try {
            data = await gasResponse.json();
        } catch {
            console.log('[compliance-digest] No JSON response from GAS');
            return new Response('No compliance data', { status: 200 });
        }

        // 2. Generate AI digest
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are the compliance officer for Shamrock Bail Bonds. Generate a morning Slack digest. Format it with:
- 📊 **Daily Compliance Summary** header
- 🔴 **Critical** section for missed check-ins > 48 hrs, approaching forfeitures
- 🟡 **Attention** section for missed check-ins < 48 hrs, payment issues  
- 🟢 **Good Standing** count
- 📋 **Action Items** numbered list of things staff should do today

Be concise and actionable. Use Slack formatting (bold, emoji, bullet points).`,
                },
                {
                    role: 'user',
                    content: `Generate today's compliance digest from this data:\n\n${JSON.stringify(data, null, 2)}`,
                },
            ],
            max_tokens: 800,
            temperature: 0.4,
        });

        const digest = completion.choices[0]?.message?.content || 'No digest generated';

        // 3. Post to Slack via GAS (GAS handles the Slack webhook)
        await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'post_slack_message',
                channel: '#compliance',
                message: digest,
            }),
            redirect: 'follow',
        });

        console.log('[compliance-digest] Digest posted to Slack');
        return new Response('Digest posted', { status: 200 });
    } catch (err) {
        console.error('[compliance-digest] Error:', err.message);
        return new Response('Error: ' + err.message, { status: 500 });
    }
};

export const config = {
    schedule: '0 13 * * *',
};
