/**
 * Google Sheets → Supabase DB 동기화
 *
 * - 시트의 "Slack" 탭 모든 행을 Supabase slack_messages 테이블로 upsert
 * - 시트의 "작품정보" 탭을 titles 테이블로 upsert
 * - permalink가 unique key라 중복 안 들어감
 * - 매일 자동 실행하면 새 행 + 업데이트된 분류값 자동 반영
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { SheetsClient } from '../src/services/sheets/SheetsClient';

const BATCH_SIZE = 500;

function parseKST(date: string, time: string): string {
  // "2026-05-21" + "14:30:22" → ISO with KST offset
  return `${date}T${time}+09:00`;
}

function safeJson(s: string): any[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseNumberOrNull(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const sheets = new SheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  // === 1) 작품 DB 동기화 ===
  console.log('1. 작품 DB 동기화 중...');
  const titleRows = await sheets.getRange(spreadsheetId, `'작품정보'!A:B`);
  const titles = titleRows.slice(1)
    .filter(r => r[0] && r[1])
    .map(r => ({ number: r[0].trim(), name: r[1].trim() }));
  console.log(`   ${titles.length}개 작품`);

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('titles').upsert(chunk, { onConflict: 'number' });
    if (error) { console.error(error); process.exit(1); }
    process.stdout.write(`\r   업로드: ${Math.min(i+BATCH_SIZE, titles.length)}/${titles.length}`);
  }
  console.log();

  // === 2) 메시지 동기화 ===
  console.log('\n2. 시트 메시지 읽기...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:Q`);
  const dataRows = rows.slice(1);
  console.log(`   ${dataRows.length}행`);

  console.log('\n3. Supabase로 변환...');
  const records: any[] = [];
  for (const r of dataRows) {
    const permalink = r[6] ?? '';
    if (!permalink) continue;

    const date = r[3] ?? '';
    const time = r[4] ?? '';
    if (!date || !time) continue;

    records.push({
      slack_permalink: permalink,
      is_reply: r[0] === 'TRUE',
      channel: r[1] || null,
      sender: r[2] || null,
      created_at: parseKST(date, time),
      message: r[5] || null,
      parent_message: r[7] || null,
      parent_link: r[8] || null,
      image_urls: safeJson(r[9]),
      image_count: parseInt(r[10] ?? '0', 10) || 0,
      image_sizes_mb: parseNumberOrNull(r[11]),
      category: r[12] || null,
      sub_category: r[13] || null,
      title_number: r[14] || null,
      title_name: r[15] || null,
      title_match: r[16] || null,
    });
  }
  console.log(`   변환 완료: ${records.length}개`);

  console.log('\n4. Supabase upsert (배치 500)...');
  const start = Date.now();
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('slack_messages')
      .upsert(chunk, { onConflict: 'slack_permalink,title_number' });
    if (error) {
      console.error('\n❌', error);
      process.exit(1);
    }
    const done = i + chunk.length;
    const elapsed = (Date.now() - start) / 1000;
    process.stdout.write(`\r   업로드: ${done}/${records.length} (${(done/elapsed).toFixed(0)}/s)`);
  }
  console.log();

  // === 3) 메타데이터 ===
  await supabase.from('sync_meta').upsert({
    key: 'last_sheets_to_supabase_sync',
    value: { count: records.length, at: new Date().toISOString() },
  });

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ 동기화 완료`);
  console.log(`   작품: ${titles.length}`);
  console.log(`   메시지/답글: ${records.length}`);
  console.log(`   소요: ${((Date.now()-start)/1000).toFixed(1)}초`);
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
