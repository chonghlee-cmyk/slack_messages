import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

/**
 * 서버 스크립트용 Supabase 클라이언트 생성.
 *
 * @supabase/supabase-js v2.10x의 realtime 모듈은 createClient 시점에
 * WebSocket 구현을 요구한다. Node 22+는 전역 WebSocket이 있어 문제없지만,
 * CI 러너가 Node 20으로 잡히면 전역 WebSocket이 없어서
 * "Node.js 20 detected without native WebSocket support" 에러로 즉시 throw →
 * 파이프라인의 Supabase 스텝(이미지 마이그레이션 / 시트→DB 동기화)이 통째로 죽는다.
 *
 * 전역 WebSocket이 없으면 `ws` 패키지를 transport로 주입해
 * Node 버전과 무관하게 항상 동작하도록 한다. (realtime 기능은 쓰지 않지만
 * createClient가 생성자에서 transport를 요구하므로 넘겨줘야 한다)
 */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  const globalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  const transport = (globalWebSocket ?? ws) as never;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport },
  });
}
