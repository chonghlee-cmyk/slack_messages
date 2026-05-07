/**
 * Phase 1 단일 작품 테스트 스크립트
 * 특정 작품번호로 Slack 검색 → Sheets에 기록
 *
 * 실행: npm run script:test-connection -- --artwork=작품번호
 * 예시: npx ts-node scripts/testSlack.ts 9125
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SyncEngine } from '../src/engine/SyncEngine';
import { logger } from '../src/utils/logger';

async function main() {
  // 커맨드라인 인수에서 작품번호 읽기
  const artworkName = process.argv[2];
  if (!artworkName) {
    console.error('\n사용법: npx ts-node scripts/testSlack.ts <작품번호>');
    console.error('예시:  npx ts-node scripts/testSlack.ts 9125\n');
    process.exit(1);
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const slackToken = process.env.SLACK_BOT_TOKEN!;
  const channelIds = (process.env.SLACK_TARGET_CHANNEL_IDS ?? '').split(',').filter(Boolean);

  if (!spreadsheetId) { console.error('❌ GOOGLE_SHEETS_SPREADSHEET_ID not set'); process.exit(1); }
  if (!slackToken)    { console.error('❌ SLACK_BOT_TOKEN not set'); process.exit(1); }
  if (!channelIds.length) { console.error('❌ SLACK_TARGET_CHANNEL_IDS not set'); process.exit(1); }

  console.log('\n──────────────────────────────────────────');
  console.log('  Slack 단일 작품 테스트');
  console.log('──────────────────────────────────────────');
  console.log(`  작품번호: ${artworkName}`);
  console.log(`  채널 수:  ${channelIds.length}개`);
  console.log(`  출력 탭:  ${process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack'}`);
  console.log('──────────────────────────────────────────\n');

  const engine = new SyncEngine({
    slackToken,
    spreadsheetId,
    artworkTab: process.env.GOOGLE_SHEETS_ARTWORK_TAB ?? '작품관리대장 2.0',
    outputTab: process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack',
    logTab: process.env.GOOGLE_SHEETS_LOG_TAB ?? 'Slack 로그',
    artworkNameColumn: Number(process.env.GOOGLE_SHEETS_ARTWORK_NAME_COLUMN ?? '0'),
    channelIds,
    excludedUserIds: (process.env.SLACK_EXCLUDED_USER_IDS ?? '').split(',').filter(Boolean),
    pageSize: 20,
    concurrency: 1,
  });

  await engine.run({
    initialLookbackDays: Number(process.env.SYNC_INITIAL_LOOKBACK_DAYS ?? '90'),
    artworkFilter: [artworkName],
    forceFullSync: true,   // 테스트는 항상 전체 조회
    dryRun: false,
  });

  console.log('\n✅ 완료! Google Sheets "Slack" 탭에서 결과를 확인하세요.\n');
}

main().catch(err => {
  logger.error({ error: err.message }, 'Test failed');
  console.error(`\n❌ 오류: ${err.message}\n`);
  process.exit(1);
});
