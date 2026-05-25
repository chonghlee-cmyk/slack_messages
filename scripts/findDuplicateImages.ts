/**
 * 같은 이미지 파일이 어떤 메시지들에서 중복되는지 확인
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';

function extractFileId(url: string): string | null {
  const m = url.match(/\/(F[A-Z0-9]+)\b/);
  return m ? m[1] : null;
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';
  const sheets = new SheetsClient();

  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:K`);
  const dataRows = rows.slice(1);

  // file_id → 등장한 메시지들 매핑
  const fileToMessages = new Map<string, Array<{
    isReply: string;
    sender: string;
    date: string;
    time: string;
    message: string;
    link: string;
  }>>();

  for (const row of dataRows) {
    const urlsStr = row[9];
    if (!urlsStr) continue;
    try {
      const list = JSON.parse(urlsStr);
      if (!Array.isArray(list)) continue;
      for (const u of list) {
        const fid = extractFileId(u);
        if (!fid) continue;
        if (!fileToMessages.has(fid)) fileToMessages.set(fid, []);
        fileToMessages.get(fid)!.push({
          isReply: row[0],
          sender: row[2],
          date: row[3],
          time: row[4],
          message: (row[5] ?? '').slice(0, 80),
          link: row[6],
        });
      }
    } catch {}
  }

  // 통계
  const buckets: Record<string, number> = { '1번': 0, '2번': 0, '3-5번': 0, '6-10번': 0, '11-50번': 0, '50번+': 0 };
  let total = 0;
  for (const [, msgs] of fileToMessages) {
    const c = msgs.length;
    total++;
    if (c === 1) buckets['1번']++;
    else if (c === 2) buckets['2번']++;
    else if (c <= 5) buckets['3-5번']++;
    else if (c <= 10) buckets['6-10번']++;
    else if (c <= 50) buckets['11-50번']++;
    else buckets['50번+']++;
  }

  console.log('═══════════════════════════════════════');
  console.log('  이미지 중복 분석');
  console.log('═══════════════════════════════════════');
  console.log(`고유 이미지: ${total}개`);
  console.log(`총 URL: ${[...fileToMessages.values()].reduce((s,m)=>s+m.length,0)}개`);
  console.log('\n등장 횟수 분포:');
  for (const [k, v] of Object.entries(buckets)) {
    const pct = (v / total * 100).toFixed(1);
    console.log(`  ${k.padEnd(8)}: ${v}개 (${pct}%)`);
  }

  // 상위 중복 이미지 5개 예시
  const sorted = [...fileToMessages.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log('\n=== 가장 많이 중복된 이미지 TOP 5 ===\n');
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const [fid, msgs] = sorted[i];
    console.log(`\n[${i+1}] File ID: ${fid} | 등장 횟수: ${msgs.length}회`);
    console.log('   등장 메시지 (앞 5개):');
    for (let j = 0; j < Math.min(5, msgs.length); j++) {
      const m = msgs[j];
      const replyMark = m.isReply === 'TRUE' ? '↳' : ' ';
      console.log(`     ${replyMark} ${m.date} ${m.time} | ${m.sender} | "${m.message}"`);
    }
    if (msgs.length > 5) console.log(`     ... 외 ${msgs.length - 5}회 더`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
