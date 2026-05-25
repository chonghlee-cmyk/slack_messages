/**
 * 시트의 M, N 컬럼 (Level, Sub Level) 삭제
 * 삭제 후 자동으로 O~S가 M~Q로 시프트됨
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import * as fs from 'fs';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!;
  const credentials = JSON.parse(fs.readFileSync(require('path').resolve(keyPath), 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth });

  // sheet ID 찾기
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === tab);
  if (!sheet) throw new Error(`Tab "${tab}" not found`);
  const sheetId = sheet.properties!.sheetId!;

  // M=12, N=13 (0-indexed) 삭제 (2개 컬럼)
  console.log('M, N 컬럼 삭제 중...');
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 12, // M
            endIndex: 14,   // N 다음 (즉 M, N 두 개 삭제)
          },
        },
      }],
    },
  });
  console.log('✅ 삭제 완료. O~S가 M~Q로 시프트됨');
}

main().catch(e => { console.error(e); process.exit(1); });
