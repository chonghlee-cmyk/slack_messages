/**
 * 샘플 이미지 다운로드 → WebP 변환 → 압축률 측정
 */
import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import sharp from 'sharp';
import { SheetsClient } from '../src/services/sheets/SheetsClient';

const SAMPLE_SIZE = 20;
const WEBP_QUALITY = 80; // 0-100, 80은 시각적으로 거의 무손실

async function downloadImage(url: string, token: string): Promise<Buffer> {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
  return Buffer.from(r.data);
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN!;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  const sheets = new SheetsClient();
  console.log('시트에서 이미지 URL 모으는 중...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:K`);
  const allUrls: string[] = [];
  for (const row of rows.slice(1)) {
    const urlsStr = row[9];
    if (!urlsStr) continue;
    try {
      const list = JSON.parse(urlsStr);
      if (Array.isArray(list)) allUrls.push(...list);
    } catch {}
  }
  console.log(`총 이미지 URL: ${allUrls.length}개`);

  // 랜덤 샘플링
  const sampled = allUrls.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
  console.log(`샘플 ${sampled.length}개 다운로드 + WebP 변환 시작...\n`);

  let totalOriginal = 0;
  let totalWebP = 0;
  let success = 0;
  const breakdown: { format: string; orig: number; webp: number; ratio: number }[] = [];

  for (let i = 0; i < sampled.length; i++) {
    const url = sampled[i];
    try {
      const buf = await downloadImage(url, token);
      const meta = await sharp(buf).metadata();
      const webp = await sharp(buf).webp({ quality: WEBP_QUALITY }).toBuffer();

      totalOriginal += buf.length;
      totalWebP += webp.length;
      success++;
      breakdown.push({
        format: meta.format ?? '?',
        orig: buf.length,
        webp: webp.length,
        ratio: webp.length / buf.length,
      });

      const origKB = (buf.length / 1024).toFixed(0);
      const webpKB = (webp.length / 1024).toFixed(0);
      const pct = ((1 - webp.length / buf.length) * 100).toFixed(1);
      console.log(`  [${i+1}/${sampled.length}] ${meta.format} ${origKB}KB → WebP ${webpKB}KB (${pct}% 감소)`);
    } catch (e: any) {
      console.log(`  [${i+1}/${sampled.length}] FAIL: ${e.message?.slice(0, 50)}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('결과');
  console.log('═══════════════════════════════════════');
  console.log(`성공한 샘플:    ${success}/${SAMPLE_SIZE}`);
  console.log(`샘플 원본 용량: ${(totalOriginal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`샘플 WebP 용량: ${(totalWebP / 1024 / 1024).toFixed(2)} MB`);
  const ratio = totalWebP / totalOriginal;
  console.log(`평균 압축률:    ${(ratio * 100).toFixed(1)}% (${((1-ratio)*100).toFixed(1)}% 감소)`);

  // 포맷별 통계
  const byFormat = new Map<string, { count: number; orig: number; webp: number }>();
  for (const b of breakdown) {
    const e = byFormat.get(b.format) ?? { count: 0, orig: 0, webp: 0 };
    e.count++; e.orig += b.orig; e.webp += b.webp;
    byFormat.set(b.format, e);
  }
  console.log('\n포맷별:');
  for (const [fmt, e] of byFormat) {
    const r = e.webp / e.orig;
    console.log(`  ${fmt}: ${e.count}장, ${(e.orig/1024/1024).toFixed(2)}MB → ${(e.webp/1024/1024).toFixed(2)}MB (${(r*100).toFixed(1)}%)`);
  }

  console.log('\n=== 전체 추정 (910 MB 원본 기준) ===');
  console.log(`WebP 후 예상: ${(910 * ratio).toFixed(0)} MB`);
  console.log(`Supabase 1GB 무료에 들어감? ${910 * ratio < 1024 ? '✅ 예' : '❌ 아니오'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
