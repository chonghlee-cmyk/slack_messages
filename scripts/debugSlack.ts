import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const client = new WebClient(token);

  console.log('\n토큰 prefix:', token.substring(0, 5));
  console.log('채널 ID:', channelId, '\n');

  console.log('1. auth.test 시도...');
  try {
    const auth = await client.auth.test();
    console.log('   ✅ OK - user:', (auth as any).user, 'team:', (auth as any).team);
  } catch (e: any) {
    console.log('   ❌ FAIL:', e.data?.error || e.message);
    return;
  }

  console.log('\n2. conversations.info 시도...');
  try {
    const info = await client.conversations.info({ channel: channelId });
    const ch = info.channel as any;
    console.log('   ✅ OK - name:', ch.name, 'is_private:', ch.is_private, 'is_member:', ch.is_member);
  } catch (e: any) {
    console.log('   ❌ FAIL:', e.data?.error || e.message);
    console.log('   전체 에러:', JSON.stringify(e.data, null, 2));
  }

  console.log('\n3. conversations.history 시도 (1개만)...');
  try {
    const hist = await client.conversations.history({ channel: channelId, limit: 1 });
    console.log('   ✅ OK - 메시지:', (hist.messages as any[])?.length);
  } catch (e: any) {
    console.log('   ❌ FAIL:', e.data?.error || e.message);
    console.log('   전체 에러:', JSON.stringify(e.data, null, 2));
  }

  console.log('\n4. 현재 토큰의 scopes 확인...');
  try {
    const result = await client.apiCall('auth.test') as any;
    // X-OAuth-Scopes 헤더에서 scope 확인은 SDK가 직접 노출 안 함, 대신 다른 방법 시도
    console.log('   OK');
  } catch (e: any) {
    console.log('   ❌', e.data?.error || e.message);
  }
}

main().catch(e => console.error(e));
