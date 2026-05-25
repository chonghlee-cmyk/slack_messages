/**
 * 시트에서 실제로 사용중인 Supabase URL과 Storage 파일 비교 → orphan 삭제
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { SheetsClient } from '../src/services/sheets/SheetsClient';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';
  const sheets = new SheetsClient();
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  console.log('1. 시트에서 실제 사용중인 파일명 수집...');
  const rows = await sheets.getRange(id, `'${tab}'!A:K`);
  const usedKeys = new Set<string>();
  for (const row of rows.slice(1)) {
    const urlsStr = row[9];
    if (!urlsStr) continue;
    try {
      const list = JSON.parse(urlsStr);
      for (const u of list) {
        const m = u.match(/\/([^\/]+\.webp)$/);
        if (m) usedKeys.add(m[1]);
      }
    } catch {}
  }
  console.log(`   시트에 사용중인 파일: ${usedKeys.size}개`);

  console.log('\n2. Storage 전체 파일 목록...');
  const allFiles: string[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.storage.from(bucket).list('', { limit: 1000, offset });
    if (!data || data.length === 0) break;
    allFiles.push(...data.map(f => f.name));
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`   Storage 파일: ${allFiles.length}개`);

  const orphans = allFiles.filter(name => !usedKeys.has(name));
  console.log(`   orphan: ${orphans.length}개`);

  if (orphans.length === 0) {
    console.log('\n✅ 정리할 orphan 없음');
    return;
  }

  console.log('\n3. orphan 삭제 중 (1000개씩)...');
  for (let i = 0; i < orphans.length; i += 1000) {
    const batch = orphans.slice(i, i + 1000);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) { console.error(error); break; }
    console.log(`   ${i + batch.length}/${orphans.length} 삭제`);
  }
  console.log('✅ 정리 완료');
}
main().catch(e => { console.error(e); process.exit(1); });
