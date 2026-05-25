import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';
  const client = new SheetsClient();

  await client.clearRange(spreadsheetId, `'${tab}'!A:Z`);
  console.log(`✅ "${tab}" 탭 데이터 삭제 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
