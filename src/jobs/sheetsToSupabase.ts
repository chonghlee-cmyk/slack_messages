import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { SheetsClient } from '../services/sheets/SheetsClient';
import { logger } from '../utils/logger';

const BATCH_SIZE = 500;

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const outputTab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set');
  if (!supabaseUrl) throw new Error('SUPABASE_URL not set');
  if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');

  const sheetsClient = new SheetsClient();
  const supabase = createClient(supabaseUrl, supabaseKey);

  logger.info('Reading Slack tab from Google Sheets...');
  const rows = await sheetsClient.getRange(spreadsheetId, `'${outputTab}'!A:G`);

  // 헤더 제외
  const dataRows = rows.slice(1).filter(row => row[0] && row[6]); // artwork_name + permalink 필수
  logger.info({ total: dataRows.length }, 'Rows loaded from Sheets');

  // Supabase에 이미 있는 permalink 로드 (중복 방지)
  logger.info('Loading existing permalinks from Supabase...');
  const existingPermalinks = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('slack_messages')
      .select('artwork_name, permalink')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    data.forEach(r => existingPermalinks.add(`${r.artwork_name}|${r.permalink}`));
    from += 1000;
    if (data.length < 1000) break;
  }
  logger.info({ existing: existingPermalinks.size }, 'Existing keys loaded');

  // 새 행만 필터링
  const newRows = dataRows.filter(row => {
    const key = `${row[0]}|${row[6]}`;
    return !existingPermalinks.has(key);
  });
  logger.info({ newRows: newRows.length }, 'New rows to insert');

  if (newRows.length === 0) {
    logger.info('Nothing to sync');
    return;
  }

  // 배치 upsert
  let inserted = 0;
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE).map(row => ({
      artwork_name:  row[0] ?? '',
      channel_name:  row[1] ?? '',
      sender:        row[2] ?? '',
      date:          row[3] ?? '',
      time:          row[4] ?? '',
      content:       row[5] ?? '',
      permalink:     row[6] ?? '',
    }));

    const { error } = await supabase
      .from('slack_messages')
      .upsert(batch, { onConflict: 'artwork_name,permalink', ignoreDuplicates: true });

    if (error) {
      logger.error({ error: error.message, batch: i }, 'Upsert failed');
      throw error;
    }

    inserted += batch.length;
    logger.info({ inserted, total: newRows.length }, 'Batch upserted');
  }

  logger.info({ inserted }, 'Sheets → Supabase sync completed');
}

main().catch(err => {
  logger.error({ error: err.message }, 'sheetsToSupabase failed');
  process.exit(1);
});
