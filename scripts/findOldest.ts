import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const client = new WebClient(token);

  console.log(`채널 ${channelId} 의 가장 오래된 메시지 찾는 중...\n`);

  let cursor: string | undefined;
  let oldestTs: string | undefined;
  let oldestText: string | undefined;
  let totalCount = 0;
  let page = 0;

  do {
    page++;
    const result: any = await client.conversations.history({
      channel: channelId,
      cursor,
      limit: 200,
    });
    const messages = (result.messages ?? []) as any[];
    totalCount += messages.length;

    if (messages.length > 0) {
      // 마지막 메시지가 이 페이지에서 가장 오래된 거
      const last = messages[messages.length - 1];
      oldestTs = last.ts;
      oldestText = last.text;
    }

    process.stdout.write(`\r페이지 ${page} | 누적 ${totalCount}개 메시지...`);
    cursor = result.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log('\n');
  console.log('═══════════════════════════════════════');
  console.log(`총 부모 메시지 수: ${totalCount}개`);
  if (oldestTs) {
    const date = new Date(Number(oldestTs) * 1000);
    const kst = date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`가장 오래된 메시지 날짜: ${kst} (KST)`);
    console.log(`내용 (앞 100자): ${(oldestText ?? '').slice(0, 100)}`);
  }
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
