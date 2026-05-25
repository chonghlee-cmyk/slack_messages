import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';

  let total = 0;
  while (true) {
    const { data } = await supabase.storage.from(bucket).list('', { limit: 1000 });
    if (!data || data.length === 0) break;
    const names = data.map(f => f.name);
    const { error } = await supabase.storage.from(bucket).remove(names);
    if (error) { console.error(error); break; }
    total += names.length;
    console.log(`삭제: ${total}개`);
    if (data.length < 1000) break;
  }
  console.log(`✅ ${total}개 파일 삭제 완료`);
}
main().catch(e => console.error(e));
