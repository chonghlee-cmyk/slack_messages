/**
 * Supabase Storage에서 unknown-*.webp 파일 일괄 삭제
 * (migrateImagesToSupabase.ts가 Supabase URL을 재처리해서 생긴 중복 파일 정리)
 *
 * 사용: npx ts-node scripts/cleanupDuplicateImages.ts
 *       npx ts-node scripts/cleanupDuplicateImages.ts --dry-run  # 삭제 없이 목록만 출력
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`버킷: ${bucket}`);
  console.log(DRY_RUN ? '모드: DRY RUN (실제 삭제 안 함)\n' : '모드: 실제 삭제\n');

  // 1. 전체 파일 목록 수집
  console.log('1. 파일 목록 수집 중...');
  const allFiles: string[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit, offset });
    if (error) { console.error('목록 조회 실패:', error.message); break; }
    if (!data || data.length === 0) break;
    data.forEach(f => allFiles.push(f.name));
    console.log(`   ${allFiles.length}개 수집됨...`);
    if (data.length < limit) break;
    offset += limit;
  }

  console.log(`   총 ${allFiles.length}개 파일`);

  // 2. unknown- 파일 필터링
  const toDelete = allFiles.filter(f => f.startsWith('unknown-'));
  const toKeep = allFiles.filter(f => !f.startsWith('unknown-'));

  console.log(`\n2. 분류:`);
  console.log(`   유지 (F*.webp 등 정상 파일): ${toKeep.length}개`);
  console.log(`   삭제 대상 (unknown-*.webp):  ${toDelete.length}개`);

  if (toDelete.length === 0) {
    console.log('\n삭제할 파일 없음. 완료.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 삭제될 파일 목록 (처음 20개):');
    toDelete.slice(0, 20).forEach(f => console.log(`  - ${f}`));
    if (toDelete.length > 20) console.log(`  ... 외 ${toDelete.length - 20}개`);
    console.log('\n실제 삭제하려면 --dry-run 없이 실행하세요.');
    return;
  }

  // 3. 일괄 삭제 (1000개씩)
  console.log(`\n3. ${toDelete.length}개 삭제 중...`);
  const CHUNK = 1000;
  let deleted = 0;

  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const chunk = toDelete.slice(i, i + CHUNK);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) {
      console.error(`  청크 ${Math.floor(i/CHUNK)+1} 삭제 실패:`, error.message);
    } else {
      deleted += chunk.length;
      console.log(`   ${deleted}/${toDelete.length} 삭제 완료`);
    }
  }

  console.log(`\n✅ 완료! ${deleted}개 삭제됨. 남은 파일: ${toKeep.length}개`);
}

main().catch(e => { console.error(e); process.exit(1); });
