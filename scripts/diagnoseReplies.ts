/**
 * 스레드별로 Slack vs 시트 답글 수 비교
 * 차이가 가장 큰 스레드 찾기
 */
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

  console.log('1. Slack 채널 history 페치 (reply_count 모으기)...');
  const threadCounts = new Map<string, { count: number; permalink: string }>();
  let cursor: string | undefined;

  do {
    const r: any = await slack.conversations.history({ channel: channelId, cursor, limit: 200 });
    for (const m of (r.messages ?? []) as any[]) {
      if (m.thread_ts && m.ts !== m.thread_ts) continue;
      if (m.reply_count > 0) {
        // permalink는 history에 안 들어옴 — ts로 키 잡기
        threadCounts.set(m.ts, { count: m.reply_count, permalink: '' });
      }
    }
    cursor = r.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  const totalSlackReplies = [...threadCounts.values()].reduce((s, t) => s + t.count, 0);
  console.log(`   스레드 ${threadCounts.size}개, 총 reply_count 합: ${totalSlackReplies}`);

  console.log('\n2. 시트에서 답글 그룹핑...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:K`);
  const dataRows = rows.slice(1);

  // 답글 → parentPermalink로 그룹핑 (시트에서 ts 추출)
  const sheetByParent = new Map<string, number>();
  for (const row of dataRows) {
    const isReply = row[0] === 'TRUE';
    if (!isReply) continue;
    const parentLink = row[8] ?? '';
    if (!parentLink) {
      sheetByParent.set('__no_parent__', (sheetByParent.get('__no_parent__') ?? 0) + 1);
      continue;
    }
    // permalink 끝부분 p1234567890123456 → 1234567890.123456 변환
    const m = parentLink.match(/\/p(\d+)(?:\?|$)/);
    if (m) {
      const tsRaw = m[1];
      // 마지막 6자리가 microseconds
      const ts = tsRaw.slice(0, -6) + '.' + tsRaw.slice(-6);
      sheetByParent.set(ts, (sheetByParent.get(ts) ?? 0) + 1);
    } else {
      sheetByParent.set('__unparseable__', (sheetByParent.get('__unparseable__') ?? 0) + 1);
    }
  }

  const totalSheetReplies = [...sheetByParent.entries()]
    .filter(([k]) => !k.startsWith('__'))
    .reduce((s, [, v]) => s + v, 0);
  console.log(`   시트 답글 수: ${totalSheetReplies}`);
  console.log(`   parent 없는 답글: ${sheetByParent.get('__no_parent__') ?? 0}`);
  console.log(`   파싱 실패: ${sheetByParent.get('__unparseable__') ?? 0}`);

  console.log('\n3. 스레드별 차이 분석...');
  const gaps: { ts: string; slack: number; sheet: number; gap: number }[] = [];
  let totalGap = 0;
  let missingThreads = 0;

  for (const [ts, info] of threadCounts) {
    const sheetCount = sheetByParent.get(ts) ?? 0;
    const gap = info.count - sheetCount;
    if (gap !== 0) {
      gaps.push({ ts, slack: info.count, sheet: sheetCount, gap });
      totalGap += gap;
      if (sheetCount === 0) missingThreads++;
    }
  }

  // 시트에 있지만 Slack에 없는 thread_ts (= permalink 파싱 이상)
  const sheetThreads = new Set([...sheetByParent.keys()].filter(k => !k.startsWith('__')));
  const slackThreadIds = new Set(threadCounts.keys());
  const orphanInSheet = [...sheetThreads].filter(t => !slackThreadIds.has(t));

  console.log(`\n전체 차이 합: ${totalGap}`);
  console.log(`완전 누락 스레드 (시트에 답글 0): ${missingThreads}개`);
  console.log(`시트엔 있는데 Slack에 매칭 안 되는 thread_ts: ${orphanInSheet.length}`);

  console.log('\n상위 누락 스레드 (gap이 큰 것):');
  gaps.sort((a, b) => b.gap - a.gap).slice(0, 15).forEach(g => {
    const date = new Date(Number(g.ts) * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`  ts=${g.ts} | Slack ${g.slack} vs 시트 ${g.sheet} = -${g.gap} | ${date}`);
  });

  if (orphanInSheet.length > 0) {
    console.log('\n시트에만 있는 thread_ts (앞 5개):');
    orphanInSheet.slice(0, 5).forEach(t => console.log(`  ${t}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
