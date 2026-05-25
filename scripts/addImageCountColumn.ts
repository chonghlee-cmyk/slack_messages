/**
 * 기존 시트에 'Image Count' 컬럼 삽입 (J와 K 사이)
 * - 현재: J=Image URLs, K=Image Sizes (MB)
 * - 변경 후: J=Image URLs, K=Image Count, L=Image Sizes (MB)
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import { SheetsClient } from '../src/services/sheets/SheetsClient';
import * as fs from 'fs';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';
  const sheets = new SheetsClient();

  // 1. 시트 ID(gid) 가져오기
  console.log('1. 시트 ID 조회...');
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!;
  const credentials = JSON.parse(fs.readFileSync(require('path').resolve(keyPath), 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === tab);
  if (!sheet) throw new Error(`Tab "${tab}" not found`);
  const sheetId = sheet.properties!.sheetId!;
  console.log(`   sheetId: ${sheetId}`);

  // 2. K열 앞에 새 컬럼 삽입 (0-indexed: J=9, K=10이므로 새 K 위치는 10)
  console.log('\n2. K열 앞에 컬럼 삽입...');
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 10, // K열
            endIndex: 11,
          },
          inheritFromBefore: false,
        },
      }],
    },
  });
  console.log('   ✅ 컬럼 삽입 완료');

  // 3. 모든 데이터 읽기 (이제 J=URLs, K=빈컬럼, L=Sizes)
  console.log('\n3. 시트 데이터 읽기...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:L`);
  const dataRows = rows.slice(1);
  console.log(`   ${dataRows.length}행`);

  // 4. K열에 Image Count 채우기 + 헤더 업데이트
  console.log('\n4. Image Count 계산 + 헤더 업데이트...');
  const headerUpdate = { range: `'${tab}'!K1`, values: [['Image Count']] };

  // 모든 데이터 행의 K열 채우기
  const dataUpdates: { range: string; values: string[][] }[] = [headerUpdate];
  for (let i = 0; i < dataRows.length; i++) {
    const urlsStr = dataRows[i][9];
    let count = '';
    if (urlsStr) {
      try {
        const list = JSON.parse(urlsStr);
        if (Array.isArray(list) && list.length > 0) count = String(list.length);
      } catch {}
    }
    dataUpdates.push({
      range: `'${tab}'!K${i + 2}`,
      values: [[count]],
    });
  }

  // 5. 배치로 업데이트 (한 번에 500씩)
  console.log(`\n5. 배치 업데이트 (${dataUpdates.length}건)...`);
  const CHUNK = 500;
  for (let i = 0; i < dataUpdates.length; i += CHUNK) {
    const chunk = dataUpdates.slice(i, i + CHUNK);
    await sheets.batchUpdate(spreadsheetId, chunk);
    console.log(`   batch ${Math.floor(i / CHUNK) + 1} 완료 (${chunk.length}건)`);
  }

  console.log('\n✅ 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
