/**
 * 최종 정밀 검증: 실제 코드의 필터링 로직과 동일하게 적용
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';
import { SheetsClient } from '../src/services/sheets/SheetsClient';

function isBot(m: any): boolean {
  if (m.bot_id) return true;
  if (m.subtype === 'bot_message') return true;
  if (!m.user && m.username) return true;
  return false;
}

function hasContent(m: any): boolean {
  const hasText = m.text && m.text.trim() !== '';
  const hasImage = (m.files ?? []).some((f: any) => f.mimetype?.startsWith('image/'));
  return hasText || hasImage;
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  const slack = new WebClient(token);
  const sheets = new SheetsClient();

  console.log('1. Slack 부모 메시지 페치 + 코드 로직 시뮬레이션...');
  let parentRaw = 0;
  let parentBot = 0;
  let parentEmpty = 0;
  let parentExpected = 0;
  const parentRefs: { ts: string; threadTs: string; replyCount: number; isBot: boolean }[] = [];
  let cursor: string | undefined;

  do {
    const r: any = await slack.conversations.history({ channel: channelId, cursor, limit: 200 });
    for (const m of (r.messages ?? []) as any[]) {
      if (m.thread_ts && m.ts !== m.thread_ts) continue; // 답글은 history에서 skip
      parentRaw++;

      const bot = isBot(m);
      const content = hasContent(m);

      if (bot) parentBot++;
      else if (!content) parentEmpty++;
      else parentExpected++;

      // 부모가 봇/빈이어도 답글은 가져옴 (현재 코드 로직)
      if (m.reply_count > 0) {
        parentRefs.push({
          ts: m.ts, threadTs: m.thread_ts ?? m.ts, replyCount: m.reply_count, isBot: bot,
        });
      }
    }
    cursor = r.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log(`   raw: ${parentRaw} | 봇: ${parentBot} | 빈: ${parentEmpty} | 시트 예상: ${parentExpected}`);

  console.log('\n2. 스레드 답글 페치 (필터링 시뮬레이션)... (시간 좀 걸림)');
  let replyExpected = 0;
  let replyBot = 0;
  let replyEmpty = 0;
  let replyTotal = 0;

  for (let i = 0; i < parentRefs.length; i++) {
    if (i % 100 === 0) process.stdout.write(`\r   진행: ${i}/${parentRefs.length}`);
    const p = parentRefs[i];
    let c: string | undefined;
    do {
      const r: any = await slack.conversations.replies({
        channel: channelId, ts: p.threadTs, cursor: c, limit: 200,
      });
      const replies = ((r.messages as any[]) ?? []).slice(1); // 부모 제외
      for (const reply of replies) {
        replyTotal++;
        if (isBot(reply)) replyBot++;
        else if (!hasContent(reply)) replyEmpty++;
        else replyExpected++;
      }
      c = r.response_metadata?.next_cursor || undefined;
      if (c) await new Promise(r => setTimeout(r, 300));
    } while (c);
  }
  console.log(`\r   raw: ${replyTotal} | 봇: ${replyBot} | 빈: ${replyEmpty} | 시트 예상: ${replyExpected}`);

  console.log('\n3. 시트 실제 카운트...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:L`);
  let sheetMsg = 0, sheetReply = 0;
  for (const row of rows.slice(1)) {
    if (row[0] === 'TRUE') sheetReply++;
    else sheetMsg++;
  }
  console.log(`   시트 부모: ${sheetMsg}, 시트 답글: ${sheetReply}`);

  console.log('\n═══════════════════════════════════════');
  console.log('  📊 최종 결과');
  console.log('═══════════════════════════════════════');
  const msgGap = parentExpected - sheetMsg;
  const replyGap = replyExpected - sheetReply;
  console.log(`📩 부모 메시지: 예상 ${parentExpected} vs 시트 ${sheetMsg} = ${msgGap === 0 ? '✅ 완벽 일치' : `차이 ${msgGap}`}`);
  console.log(`💬 답글:       예상 ${replyExpected} vs 시트 ${sheetReply} = ${replyGap === 0 ? '✅ 완벽 일치' : `차이 ${replyGap}`}`);
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
