import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const client = new WebClient(token);

  console.log('토큰 prefix:', token.substring(0, 5));

  console.log('\nauth.test로 scope 확인 시도...');
  try {
    const auth = await client.auth.test();
    console.log('user:', (auth as any).user);
    console.log('team:', (auth as any).team);
  } catch (e: any) {
    console.log('FAIL:', e.data?.error);
  }

  console.log('\nusergroups.list 시도...');
  try {
    const result = await client.usergroups.list({ include_disabled: true });
    const groups = (result.usergroups as any[]) ?? [];
    console.log(`✅ 성공! 그룹 ${groups.length}개:`);
    for (const g of groups.slice(0, 5)) {
      console.log(`  - ${g.id}: name="${g.name}" handle="${g.handle}"`);
    }
  } catch (e: any) {
    console.log('❌ FAIL:', e.data?.error);
    console.log('   needed:', e.data?.needed);
    console.log('   provided:', e.data?.provided);
  }
}

main().catch(e => console.error(e));
