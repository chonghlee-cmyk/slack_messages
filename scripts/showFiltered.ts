/**
 * 봇/시스템/빈 메시지로 필터링된 메시지 예시 보기
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const channelId = process.env.SLACK_TARGET_CHANNEL_ID!;
  const slack = new WebClient(token);

  console.log('Slack에서 전체 history 조회 중...\n');

  const bots: any[] = [];
  const systems: any[] = [];
  const empties: any[] = [];

  let cursor: string | undefined;
  do {
    const r: any = await slack.conversations.history({ channel: channelId, cursor, limit: 200 });
    for (const m of (r.messages ?? []) as any[]) {
      if (m.thread_ts && m.ts !== m.thread_ts) continue;

      const isBot = m.bot_id || m.subtype === 'bot_message' || (!m.user && m.username);
      const hasImage = (m.files ?? []).some((f: any) => f.mimetype?.startsWith('image/'));
      const hasText = m.text && m.text.trim() !== '';
      const isSystem = m.subtype && m.subtype !== 'thread_broadcast' && !isBot;
      const isEmpty = !hasText && !hasImage && !isBot && !isSystem;

      if (isBot) bots.push(m);
      else if (isSystem) systems.push(m);
      else if (isEmpty) empties.push(m);
    }
    cursor = r.response_metadata?.next_cursor || undefined;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  console.log(`총 필터링: 봇 ${bots.length}, 시스템 ${systems.length}, 빈 메시지 ${empties.length}\n`);

  const ts2date = (ts: string) => new Date(Number(ts) * 1000)
    .toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  console.log('═══════════════════════════════════════');
  console.log('  🤖 봇 메시지 예시 (앞 5개)');
  console.log('═══════════════════════════════════════');
  bots.slice(0, 5).forEach((m, i) => {
    console.log(`\n[${i+1}] ${ts2date(m.ts)}`);
    console.log(`    bot_id=${m.bot_id} subtype=${m.subtype} username=${m.username}`);
    console.log(`    text: "${(m.text ?? '').slice(0, 120)}"`);
  });

  console.log('\n═══════════════════════════════════════');
  console.log('  ⚙️ 시스템 메시지 예시 (앞 5개)');
  console.log('═══════════════════════════════════════');
  systems.slice(0, 5).forEach((m, i) => {
    console.log(`\n[${i+1}] ${ts2date(m.ts)}`);
    console.log(`    subtype=${m.subtype} user=${m.user}`);
    console.log(`    text: "${(m.text ?? '').slice(0, 120)}"`);
  });

  console.log('\n═══════════════════════════════════════');
  console.log('  📭 빈 메시지 예시 (앞 5개)');
  console.log('═══════════════════════════════════════');
  empties.slice(0, 5).forEach((m, i) => {
    console.log(`\n[${i+1}] ${ts2date(m.ts)}`);
    console.log(`    user=${m.user} subtype=${m.subtype}`);
    console.log(`    text: "${(m.text ?? '').slice(0, 120)}"`);
    console.log(`    files: ${(m.files ?? []).length}개`);
  });

  // 봇 분류 (어떤 봇이 가장 많이?)
  console.log('\n═══════════════════════════════════════');
  console.log('  봇별 메시지 수 TOP 5');
  console.log('═══════════════════════════════════════');
  const botStats = new Map<string, { count: number; sample: any }>();
  for (const m of bots) {
    const key = m.bot_id || m.username || 'unknown';
    const e = botStats.get(key) ?? { count: 0, sample: m };
    e.count++;
    botStats.set(key, e);
  }
  [...botStats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5).forEach(([id, info]) => {
    console.log(`\n  ${id}: ${info.count}개`);
    console.log(`    예시: "${(info.sample.text ?? '').slice(0, 80)}"`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
