import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';

  const { data } = await supabase.storage.from(bucket).list('', { limit: 1000 });
  if (!data) return;

  console.log(`총 파일: ${data.length}`);
  console.log('\n샘플 (앞 30개 이름):');
  data.slice(0, 30).forEach(f => console.log(`  ${f.name}`));

  // 패턴 분류
  let fIdLike = 0;  // F로 시작 + 숫자/대문자
  let imageLike = 0; // image.webp 같은 일반 이름
  let other = 0;
  for (const f of data) {
    if (/^F[A-Z0-9]+\.webp$/.test(f.name)) fIdLike++;
    else if (/^image[.\-]/i.test(f.name) || f.name === 'image.webp') imageLike++;
    else other++;
  }
  console.log(`\n패턴 분석:`);
  console.log(`  F-prefix (F123.webp): ${fIdLike}`);
  console.log(`  일반 이름 (image.webp 등): ${imageLike}`);
  console.log(`  기타: ${other}`);
}
main().catch(e => console.error(e));
