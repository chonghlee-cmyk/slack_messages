/**
 * 채널 수집 테스트 스크립트
 * 설정된 채널에서 메시지를 수집해 Google Sheets에 기록
 *
 * 실행: npx ts-node scripts/testSlack.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SyncEngine } from '../src/engine/SyncEngine';
import { logger } from '../src/utils/logger';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const slackToken = process.env.SLACK_BOT_TOKEN!;
  const channelId = (process.env.SLACK_TARGET_CHANNEL_ID ?? '').trim();

  if (!spreadsheetId) { console.error('❌ GOOGLE_SHEETS_SPREADSHEET_ID not set'); process.exit(1); }
  if (!slackToken)    { console.error('❌ SLACK_BOT_TOKEN not set'); process.exit(1); }
  if (!channelId)     { console.error('❌ SLACK_TARGET_CHANNEL_ID not set'); process.exit(1); }

  console.log('\n──────────────────────────────────────────');
  console.log('  Slack 채널 수집 테스트');
  console.log('──────────────────────────────────────────');
  console.log(`  채널 ID:  ${channelId}`);
  console.log(`  출력 탭:  ${process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack'}`);
  console.log('──────────────────────────────────────────\n');

  const engine = new SyncEngine({
    slackToken,
    spreadsheetId,
    channelId,
    outputTab: process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack',
    logTab: process.env.GOOGLE_SHEETS_LOG_TAB ?? 'Slack 로그',
    excludedUserIds: (process.env.SLACK_EXCLUDED_USER_IDS ?? '').split(',').filter(Boolean),
    initialLookbackDays: Number(process.env.SYNC_INITIAL_LOOKBACK_DAYS ?? '90'),
    incrementalLookbackDays: Number(process.env.SYNC_INCREMENTAL_LOOKBACK_DAYS ?? '30'),
  });

  await engine.run({
    forceFullSync: process.env.FORCE_FULL_SYNC === 'true',
    dryRun: process.env.DRY_RUN === 'true',
  });

  console.log('\n✅ 완료! Google Sheets "Slack" 탭에서 결과를 확인하세요.\n');
}

main().catch(err => {
  logger.error({ error: err.message }, 'Test failed');
  console.error(`\n❌ 오류: ${err.message}\n`);
  process.exit(1);
});
