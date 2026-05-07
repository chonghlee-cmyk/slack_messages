import * as dotenv from 'dotenv';
dotenv.config();

import { SyncEngine } from '../engine/SyncEngine';
import { logger } from '../utils/logger';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const slackToken = process.env.SLACK_BOT_TOKEN!;
  const channelIds = (process.env.SLACK_TARGET_CHANNEL_IDS ?? '').split(',').filter(Boolean);
  const excludedUserIds = (process.env.SLACK_EXCLUDED_USER_IDS ?? '').split(',').filter(Boolean);

  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set');
  if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set');
  if (channelIds.length === 0) throw new Error('SLACK_TARGET_CHANNEL_IDS not set');

  const engine = new SyncEngine({
    slackToken,
    spreadsheetId,
    artworkTab: process.env.GOOGLE_SHEETS_ARTWORK_TAB ?? '작품관리대장 2.0',
    outputTab: process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack',
    logTab: process.env.GOOGLE_SHEETS_LOG_TAB ?? 'Slack 로그',
    artworkNameColumn: Number(process.env.GOOGLE_SHEETS_ARTWORK_NAME_COLUMN ?? '0'),
    channelIds,
    excludedUserIds,
    pageSize: Number(process.env.SLACK_SEARCH_PAGE_SIZE ?? '20'),
    concurrency: Number(process.env.SYNC_CONCURRENCY ?? '3'),
  });

  await engine.run({
    initialLookbackDays: Number(process.env.SYNC_INITIAL_LOOKBACK_DAYS ?? '90'),
    forceFullSync: process.env.FORCE_FULL_SYNC === 'true',
    artworkFilter: process.env.ARTWORK_FILTER
      ? process.env.ARTWORK_FILTER.split(',').map(s => s.trim())
      : undefined,
    dryRun: process.env.DRY_RUN === 'true',
  });
}

main().catch(err => {
  logger.error({ error: err.message }, 'Sync failed');
  process.exit(1);
});
