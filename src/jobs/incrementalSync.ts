import * as dotenv from 'dotenv';
dotenv.config();

import { SyncEngine } from '../engine/SyncEngine';
import { logger } from '../utils/logger';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const slackToken = process.env.SLACK_BOT_TOKEN!;
  const channelId = (process.env.SLACK_TARGET_CHANNEL_ID ?? '').trim();
  const excludedUserIds = (process.env.SLACK_EXCLUDED_USER_IDS ?? '').split(',').filter(Boolean);

  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set');
  if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set');
  if (!channelId) throw new Error('SLACK_TARGET_CHANNEL_ID not set');

  const engine = new SyncEngine({
    slackToken,
    spreadsheetId,
    channelId,
    outputTab: process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack',
    logTab: process.env.GOOGLE_SHEETS_LOG_TAB ?? 'Slack 로그',
    excludedUserIds,
    initialLookbackDays: Number(process.env.SYNC_INITIAL_LOOKBACK_DAYS ?? '0'),
  });

  await engine.run({
    forceFullSync: process.env.FORCE_FULL_SYNC === 'true',
    dryRun: process.env.DRY_RUN === 'true',
  });
}

main().catch(err => {
  logger.error({ error: err.message }, 'Sync failed');
  process.exit(1);
});
