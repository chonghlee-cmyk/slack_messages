import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

async function main() {
  console.log('=== 환경변수 확인 ===');
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
  console.log('SUPABASE_STORAGE_BUCKET:', process.env.SUPABASE_STORAGE_BUCKET ?? '(없음, 기본: slack-images)');
  console.log('Service Role Key 앞 20자:', process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 20));

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('\n=== 버킷 목록 ===');
  const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
  if (bErr) { console.error(bErr.message); return; }
  buckets?.forEach(b => console.log(`  - ${b.name} (public: ${b.public}, id: ${b.id})`));

  const targetBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';
  console.log(`\n=== '${targetBucket}' 첫 5개 파일 ===`);
  const { data, error } = await supabase.storage.from(targetBucket).list('', { limit: 5 });
  if (error) { console.error(error.message); return; }
  data?.forEach(f => console.log(`  - ${f.name} (${f.metadata?.size ?? '?'} bytes, created: ${f.created_at})`));
}

main().catch(console.error);
