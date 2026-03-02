/**
 * Sentiment Watchdog — Scheduled Function (Every 4 Hours)
 * Cron: 0 */4 * * *
 *
 * Fetches recent client messages / updates from GAS, runs each through
    * GPT - 4o - mini stress classifier to detect flight - risk indicators.
 *
 * Sentiment levels: calm | concerned | stressed | alarmed
    *
 * "Alarmed" messages auto - escalate to Slack #alerts with full context.
 * "Stressed" messages get flagged in the daily briefing.
 *
 * Key stress indicators:
 * - Asking about travel / leaving state
    * - Inquiring about consequences of missing court
        * - Requesting early termination / bond cancellation
            * - Mentions of "running", "disappearing", "warrant"
                * - Sudden urgency about financial obligations
                    */
import { getOpenAI, GAS_ENDPOINT } from './shared/ai-client.mjs';

const CLASSIFIER_PROMPT = `You are a bail bond risk analyst. Classify the sentiment of client messages to detect potential flight risk.

For each message, return a JSON object:
- "sentiment": "calm" | "concerned" | "stressed" | "alarmed"
- "stressIndicators": array of detected risk phrases (empty if calm)
- "explanation": 1-sentence explanation of classification
- "flightRiskDelta": integer -10 to +10 (how much this changes flight risk. 0 = neutral)

Classification guide:
- "calm": Routine updates, positive tone, compliance indicators
- "concerned": Minor worry, reasonable questions about process
- "stressed": Financial pressure, mentions of consequences, frustration with system
- "alarmed": Travel mentions, consequences of FTA, skipping, running, disappearing, leaving state, urgent financial questions

IMPORTANT: Most messages will be "calm" or "concerned". Only flag "stressed" or "alarmed" when there are genuine indicators. Avoid false positives.

Return ONLY valid JSON. No markdown.`;

export default async () => {
    console.log('[sentiment-watchdog] Analyzing recent client messages...');

    try {
        // 1. Fetch recent unanalyzed client messages from GAS
        const gasResponse = await fetch(GAS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'get_recent_client_messages', hoursSince: 4 }),
            redirect: 'follow',
        });

        let data;
        try {
            data = await gasResponse.json();
        } catch {
            console.log('[sentiment-watchdog] No JSON response from GAS — endpoint may not exist yet');
            return new Response('GAS endpoint not ready', { status: 200 });
        }

        if (!data?.messages || data.messages.length === 0) {
            console.log('[sentiment-watchdog] No new messages to analyze');
            return new Response('No new messages', { status: 200 });
        }

        console.log(`[sentiment-watchdog] Analyzing ${data.messages.length} message(s)`);

        // 2. Batch classify messages with GPT-4o-mini
        const openai = getOpenAI();
        const flagged = [];

        // Process in batches of 5 to avoid token limits
        const batchSize = 5;
        for (let i = 0; i < data.messages.length; i += batchSize) {
            const batch = data.messages.slice(i, i + batchSize);

            const batchPrompt = batch.map((msg, idx) => (
                `Message ${idx + 1} (Case: ${msg.caseNumber || 'N/A'}, From: ${msg.name || 'Unknown'}, Channel: ${msg.channel || 'unknown'}):\n"${msg.message}"`
            )).join('\n\n');

            try {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: CLASSIFIER_PROMPT },
                        {
                            role: 'user',
                            content: `Classify these ${batch.length} message(s). Return a JSON array with one object per message:\n\n${batchPrompt}`,
                        },
                    ],
                    max_tokens: 600,
                    temperature: 0.2,
                });

                const content = completion.choices[0]?.message?.content || '[]';
                let results;
                try {
                    results = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
                    // Normalize to array
                    if (!Array.isArray(results)) results = [results];
                } catch {
                    console.warn('[sentiment-watchdog] Failed to parse AI response for batch');
                    continue;
                }

                // Match results back to messages
                results.forEach((result, idx) => {
                    if (idx >= batch.length) return;
                    const msg = batch[idx];
                    const sentiment = result.sentiment || 'calm';

                    if (sentiment === 'stressed' || sentiment === 'alarmed') {
                        flagged.push({
                            caseNumber: msg.caseNumber,
                            name: msg.name,
                            channel: msg.channel,
                            message: msg.message,
                            timestamp: msg.timestamp,
                            sentiment,
                            stressIndicators: result.stressIndicators || [],
                            explanation: result.explanation || '',
                            flightRiskDelta: result.flightRiskDelta || 0,
                        });
                    }
                });

            } catch (aiErr) {
                console.warn('[sentiment-watchdog] AI batch error:', aiErr.message);
            }
        }

        // 3. Escalate flagged messages
        if (flagged.length > 0) {
            console.log(`[sentiment-watchdog] ${flagged.length} message(s) flagged for review`);

            // Build Slack alerts for "alarmed" messages
            const alarmed = flagged.filter(f => f.sentiment === 'alarmed');
            const stressed = flagged.filter(f => f.sentiment === 'stressed');

            for (const alert of alarmed) {
                const slackMessage = [
                    `🚨 *SENTIMENT ALERT — ALARMED*`,
                    ``,
                    `*Case:* ${alert.caseNumber || 'N/A'}`,
                    `*From:* ${alert.name || 'Unknown'} (via ${alert.channel || 'unknown'})`,
                    `*Message:* "${alert.message}"`,
                    `*Stress Indicators:* ${alert.stressIndicators.join(', ') || 'None detected'}`,
                    `*Analysis:* ${alert.explanation}`,
                    `*Flight Risk Impact:* ${alert.flightRiskDelta > 0 ? '+' : ''}${alert.flightRiskDelta}`,
                    ``,
                    `⚠️ Immediate attention recommended.`,
                ].join('\n');

                try {
                    await fetch(GAS_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify({
                            action: 'post_slack_message',
                            channel: '#alerts',
                            message: slackMessage,
                        }),
                        redirect: 'follow',
                    });
                } catch (err) {
                    console.warn('[sentiment-watchdog] Slack alert failed:', err.message);
                }
            }

            // Flag stressed + alarmed cases in GAS for tracking
            await fetch(GAS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'flag_high_stress_case',
                    flagged,
                    timestamp: new Date().toISOString(),
                }),
                redirect: 'follow',
            }).catch(err => console.warn('[sentiment-watchdog] GAS flag error:', err.message));

            const summary = `Flagged ${alarmed.length} alarmed, ${stressed.length} stressed out of ${data.messages.length} total`;
            console.log(`[sentiment-watchdog] ${summary}`);
            return new Response(summary, { status: 200 });
        }

        console.log('[sentiment-watchdog] All messages classified as calm/concerned ✓');
        return new Response(`Analyzed ${data.messages.length} messages — all clear`, { status: 200 });
    } catch (err) {
        console.error('[sentiment-watchdog] Error:', err.message);
        return new Response('Error: ' + err.message, { status: 500 });
    }
};

export const config = {
    schedule: '0 */4 * * *',
};
