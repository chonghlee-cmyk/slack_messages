import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';
import { SheetsClient } from '../src/services/sheets/SheetsClient';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  const slack = new WebClient(token);
  const sheets = new SheetsClient();

  console.log('═══════════════════════════════════════');
  console.log('  데이터 검증');
  console.log('═══════════════════════════════════════\n');

  // 1. Slack 전체 카운트
  console.log('1. Slack에서 직접 전체 조회 중...');
  let totalRawMessages = 0;
  let totalExpectedReplies = 0;
  let botMessageCount = 0;
  let systemMessageCount = 0;
  let emptyTextCount = 0;
  let cursor: string | undefined;
  const slackPermalinks = new Set<string>();
  let oldestTs = Infinity;
  let newestTs = 0;

  do {
    const result: any = await slack.conversations.history({
      channel: channelId,
      cursor,
      limit: 200,
    });
    const messages = (result.messages ?? []) as any[];

    for (const m of messages) {
      // 답글이 history에 포함된 경우 스킵 (수집기와 동일)
      if (m.thread_ts && m.ts !== m.thread_ts) continue;

      totalRawMessages++;
      const ts = Number(m.ts);
      if (ts < oldestTs) oldestTs = ts;
      if (ts > newestTs) newestTs = ts;

      // 분류
      if (m.bot_id || m.subtype === 'bot_message') botMessageCount++;
      else if (!m.user && m.username) botMessageCount++;
      else if (m.subtype && m.subtype !== 'thread_broadcast') systemMessageCount++;
      else if (!m.text || m.text.trim() === '') {
        // 이미지만 있는 경우도 있음
        const hasImage = (m.files ?? []).some((f: any) => f.mimetype?.startsWith('image/'));
        if (!hasImage) emptyTextCount++;
      }

      // reply_count 합산
      if (m.reply_count) totalExpectedReplies += m.reply_count;
    }

    cursor = result.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log(`   - 전체 부모 메시지 (raw):     ${totalRawMessages}개`);
  console.log(`   - 봇/webhook 메시지:           ${botMessageCount}개`);
  console.log(`   - 시스템 메시지 (참여/나감 등): ${systemMessageCount}개`);
  console.log(`   - 빈 메시지 (이미지 없음):     ${emptyTextCount}개`);
  console.log(`   - 예상 수집 대상 메시지:       ${totalRawMessages - botMessageCount - systemMessageCount - emptyTextCount}개`);
  console.log(`   - 예상 답글 수 (reply_count 합): ${totalExpectedReplies}개`);
  console.log(`   - 가장 오래된 메시지: ${new Date(oldestTs * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`   - 가장 최근 메시지:   ${new Date(newestTs * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  // 2. 시트에서 데이터 가져오기
  console.log('\n2. 시트에서 데이터 조회 중...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:J`);
  const dataRows = rows.slice(1); // 헤더 제외

  let sheetMessages = 0;
  let sheetReplies = 0;
  let sheetWithImages = 0;
  let earliestSheet = '9999-99-99';
  let latestSheet = '0000-00-00';

  for (const row of dataRows) {
    const isReply = row[0] === 'TRUE';
    if (isReply) sheetReplies++;
    else sheetMessages++;

    if (row[9] && row[9] !== '') sheetWithImages++;

    const dateStr = row[3];
    if (dateStr) {
      if (dateStr < earliestSheet) earliestSheet = dateStr;
      if (dateStr > latestSheet) latestSheet = dateStr;
    }
  }

  console.log(`   - 시트 전체 행 수: ${dataRows.length}`);
  console.log(`   - 시트 부모 메시지: ${sheetMessages}개`);
  console.log(`   - 시트 답글:       ${sheetReplies}개`);
  console.log(`   - 이미지 포함 행:   ${sheetWithImages}개`);
  console.log(`   - 시트 최초 날짜: ${earliestSheet}`);
  console.log(`   - 시트 최신 날짜: ${latestSheet}`);

  // 3. 비교
  console.log('\n3. 비교 결과');
  console.log('═══════════════════════════════════════');
  const expectedMessages = totalRawMessages - botMessageCount - systemMessageCount - emptyTextCount;
  const msgDiff = expectedMessages - sheetMessages;
  const replyDiff = totalExpectedReplies - sheetReplies;

  console.log(`📩 부모 메시지: 예상 ${expectedMessages} vs 시트 ${sheetMessages} = 차이 ${msgDiff}`);
  console.log(`💬 답글:       예상 ${totalExpectedReplies} vs 시트 ${sheetReplies} = 차이 ${replyDiff}`);

  if (Math.abs(msgDiff) <= 10) console.log('   ✅ 부모 메시지 정상');
  else console.log('   ⚠️  부모 메시지 차이 큼 (필터링 외 추가 분석 필요)');

  if (Math.abs(replyDiff) <= 50) console.log('   ✅ 답글 정상 (봇/시스템 답글 차이 허용)');
  else console.log('   ⚠️  답글 차이 큼');

  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
