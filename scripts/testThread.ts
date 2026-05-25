import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const threadTs = '1752717314.651149'; // 1163개 답글 있다는 그 스레드

  const slack = new WebClient(token);

  let cursor: string | undefined;
  let totalFetched = 0;
  let page = 0;
  let lastHasMore: boolean | undefined;

  do {
    page++;
    const r: any = await slack.conversations.replies({
      channel: channelId,
      ts: threadTs,
      cursor,
      limit: 200,
    });
    const messages = (r.messages as any[]) ?? [];
    totalFetched += messages.length;
    lastHasMore = r.has_more;

    console.log(`페이지 ${page}: ${messages.length}개 메시지 | has_more=${r.has_more} | cursor="${r.response_metadata?.next_cursor ?? ''}"`);

    cursor = r.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log(`\n총 페이지: ${page}, 총 메시지: ${totalFetched} (부모 포함)`);
}

main().catch(e => console.error(e));
