import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';

  // Storage 파일 수 + 총 용량
  let totalFiles = 0;
  let totalBytes = 0;
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list('', {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    for (const f of data) {
      totalFiles++;
      totalBytes += (f.metadata as any)?.size ?? 0;
    }
    if (data.length < limit) break;
    offset += limit;
  }

  // progress 파일에서 완료 개수
  const progressFile = path.resolve(process.cwd(), 'data', 'image-migration.json');
  let progressDone = 0;
  if (fs.existsSync(progressFile)) {
    progressDone = Object.keys(JSON.parse(fs.readFileSync(progressFile, 'utf-8'))).length;
  }

  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  const pct = (totalFiles / 2519 * 100).toFixed(1);
  console.log(`Supabase Storage [${bucket}]`);
  console.log(`  파일 수: ${totalFiles}/2519 (${pct}%)`);
  console.log(`  총 용량: ${mb} MB (1024 MB 무료 한도)`);
  console.log(`  진행 파일 기록: ${progressDone}건`);
}
main().catch(e => console.error(e));
