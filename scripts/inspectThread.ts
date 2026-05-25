import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const threadTs = '1752717314.651149';

  const slack = new WebClient(token);

  let cursor: string | undefined;
  const allReplies: any[] = [];
  do {
    const r: any = await slack.conversations.replies({
      channel: channelId, ts: threadTs, cursor, limit: 200,
    });
    const messages = (r.messages as any[]) ?? [];
    allReplies.push(...messages.slice(1)); // 부모 제외
    cursor = r.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log(`총 답글: ${allReplies.length}`);

  let bot = 0, hasUser = 0, empty = 0, hasImg = 0, normal = 0;
  const subtypes = new Map<string, number>();
  const sampleNormal: any[] = [];
  const sampleBot: any[] = [];

  for (const r of allReplies) {
    const isBot = r.bot_id || r.subtype === 'bot_message' || (!r.user && r.username);
    const text = (r.text ?? '').trim();
    const hasImage = (r.files ?? []).some((f: any) => f.mimetype?.startsWith('image/'));

    if (r.subtype) subtypes.set(r.subtype, (subtypes.get(r.subtype) ?? 0) + 1);

    if (isBot) bot++;
    else if (r.user) hasUser++;
    if (!text && !hasImage) empty++;
    if (hasImage) hasImg++;
    if (!isBot && (text || hasImage)) {
      normal++;
      if (sampleNormal.length < 3) sampleNormal.push(r);
    } else if (isBot && sampleBot.length < 3) sampleBot.push(r);
  }

  console.log(`봇:                 ${bot}`);
  console.log(`user 있음:          ${hasUser}`);
  console.log(`텍스트+이미지 없음:  ${empty}`);
  console.log(`이미지 있음:         ${hasImg}`);
  console.log(`수집 대상 (normal): ${normal}`);
  console.log(`subtypes:`, Object.fromEntries(subtypes));

  console.log('\n샘플 normal 답글:');
  sampleNormal.forEach((r, i) => {
    console.log(`  [${i+1}] user=${r.user} subtype=${r.subtype} text="${(r.text ?? '').slice(0, 60)}"`);
  });
  if (sampleBot.length > 0) {
    console.log('\n샘플 봇 답글:');
    sampleBot.forEach((r, i) => {
      console.log(`  [${i+1}] bot_id=${r.bot_id} subtype=${r.subtype} username=${r.username} text="${(r.text ?? '').slice(0, 60)}"`);
    });
  }
}

main().catch(e => console.error(e));
