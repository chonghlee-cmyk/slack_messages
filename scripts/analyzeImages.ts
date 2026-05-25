import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';
  const client = new SheetsClient();

  const rows = await client.getRange(spreadsheetId, `'${tab}'!A:K`);
  const dataRows = rows.slice(1);

  let totalMB = 0;
  let imageRowCount = 0;
  let maxMB = 0;
  let urls = 0;
  const sizeBuckets = { '0-0.5': 0, '0.5-2': 0, '2-5': 0, '5-10': 0, '10+': 0 };

  for (const row of dataRows) {
    const sizeStr = row[10]; // K열
    const urlStr = row[9];   // J열
    if (urlStr && urlStr !== '') {
      try {
        const list = JSON.parse(urlStr);
        if (Array.isArray(list)) urls += list.length;
      } catch {}
    }
    if (sizeStr && sizeStr !== '') {
      const mb = parseFloat(sizeStr);
      if (!isNaN(mb)) {
        totalMB += mb;
        imageRowCount++;
        if (mb > maxMB) maxMB = mb;
        if (mb < 0.5) sizeBuckets['0-0.5']++;
        else if (mb < 2) sizeBuckets['0.5-2']++;
        else if (mb < 5) sizeBuckets['2-5']++;
        else if (mb < 10) sizeBuckets['5-10']++;
        else sizeBuckets['10+']++;
      }
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('  이미지 용량 분석');
  console.log('═══════════════════════════════════════');
  console.log(`이미지 포함 행: ${imageRowCount}개`);
  console.log(`총 이미지 수:   ${urls}장`);
  console.log(`총 용량:        ${totalMB.toFixed(2)} MB (${(totalMB/1024).toFixed(2)} GB)`);
  console.log(`평균 (행당):    ${(totalMB/imageRowCount).toFixed(2)} MB`);
  console.log(`최대 (행당):    ${maxMB.toFixed(2)} MB`);
  console.log('\n분포 (행당 합계 MB):');
  for (const [k, v] of Object.entries(sizeBuckets)) {
    const pct = (v / imageRowCount * 100).toFixed(1);
    console.log(`  ${k} MB: ${v}행 (${pct}%)`);
  }
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
