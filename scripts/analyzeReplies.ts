/**
 * 답글 누락 원인 분석
 * 랜덤 샘플 스레드 20개를 직접 페치해서 봇/시스템/빈 메시지 비율 확인
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const slack = new WebClient(token);

  // 모든 history에서 reply_count > 0 인 스레드 찾기
  console.log('스레드 있는 메시지 수집 중...');
  let cursor: string | undefined;
  const threadsWithReplies: { ts: string; count: number }[] = [];

  do {
    const r: any = await slack.conversations.history({ channel: channelId, cursor, limit: 200 });
    for (const m of (r.messages ?? []) as any[]) {
      if (m.thread_ts && m.ts !== m.thread_ts) continue;
      if (m.reply_count > 0) threadsWithReplies.push({ ts: m.ts, count: m.reply_count });
    }
    cursor = r.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log(`총 답글 보유 스레드: ${threadsWithReplies.length}개\n`);

  // 랜덤 20개 샘플링
  const sample = threadsWithReplies.sort(() => Math.random() - 0.5).slice(0, 20);

  let totalActualReplies = 0;
  let totalBotReplies = 0;
  let totalEmptyReplies = 0;
  let totalUserReplies = 0;

  console.log('샘플 스레드 분석 중...\n');
  for (const t of sample) {
    let c: string | undefined;
    do {
      const r: any = await slack.conversations.replies({
        channel: channelId,
        ts: t.ts,
        cursor: c,
        limit: 200,
      });
      const replies = ((r.messages as any[]) ?? []).slice(1); // 부모 제외
      for (const reply of replies) {
        totalActualReplies++;
        const isBot = reply.bot_id || reply.subtype === 'bot_message' || (!reply.user && reply.username);
        const hasImage = (reply.files ?? []).some((f: any) => f.mimetype?.startsWith('image/'));
        const hasText = reply.text && reply.text.trim() !== '';

        if (isBot) totalBotReplies++;
        else if (!hasText && !hasImage) totalEmptyReplies++;
        else totalUserReplies++;
      }
      c = r.response_metadata?.next_cursor || undefined;
      if (c) await new Promise(r => setTimeout(r, 300));
    } while (c);
  }

  const expectedFromCount = sample.reduce((s, t) => s + t.count, 0);

  console.log('═══════════════════════════════════════');
  console.log(`샘플: ${sample.length} 스레드`);
  console.log(`reply_count 합계:    ${expectedFromCount}`);
  console.log(`실제 페치된 답글:    ${totalActualReplies}`);
  console.log('─────────────────────────────────────');
  console.log(`  유저 답글 (수집됨): ${totalUserReplies} (${(totalUserReplies/totalActualReplies*100).toFixed(1)}%)`);
  console.log(`  봇 답글 (필터링):   ${totalBotReplies} (${(totalBotReplies/totalActualReplies*100).toFixed(1)}%)`);
  console.log(`  빈 답글 (필터링):   ${totalEmptyReplies} (${(totalEmptyReplies/totalActualReplies*100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════');

  // 전체 추정
  const botRatio = totalBotReplies / totalActualReplies;
  const emptyRatio = totalEmptyReplies / totalActualReplies;
  const totalReplyCount = threadsWithReplies.reduce((s, t) => s + t.count, 0);
  console.log(`\n전체 추정 (스레드 ${threadsWithReplies.length}개 기준):`);
  console.log(`  총 답글:       ${totalReplyCount}`);
  console.log(`  봇 추정:       ${Math.round(totalReplyCount * botRatio)}`);
  console.log(`  빈 답글 추정:  ${Math.round(totalReplyCount * emptyRatio)}`);
  console.log(`  수집 추정:     ${Math.round(totalReplyCount * (1 - botRatio - emptyRatio))}`);
}

main().catch(e => { console.error(e); process.exit(1); });
