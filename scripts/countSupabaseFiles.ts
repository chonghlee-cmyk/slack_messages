import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';

  let total = 0;
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit, offset });
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    total += data.length;
    console.log(`  누적: ${total}개...`);
    if (data.length < limit) break;
    offset += limit;
  }

  console.log(`\n✅ Supabase Storage 총 파일 수: ${total}개`);
}

main().catch(console.error);
