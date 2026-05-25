/**
 * Slack 이미지 → WebP 변환 → Supabase Storage 업로드 → 시트 업데이트
 *
 * 동작:
 * 1. 시트에서 모든 Image URLs 수집
 * 2. 각 이미지: Slack 다운로드 → WebP 변환 → Supabase 업로드
 * 3. 시트의 Image URLs 컬럼에 Supabase 공개 URL로 교체
 *
 * 재시작 가능: 이미 업로드된 파일은 스킵
 */
import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { SheetsClient } from '../src/services/sheets/SheetsClient';
import * as fs from 'fs';
import * as path from 'path';

const PROGRESS_FILE = path.resolve(process.cwd(), 'data', 'image-migration.json');
const WEBP_QUALITY = 80;
const CONCURRENCY = 3; // 동시 다운로드/업로드

type ProgressMap = Record<string, string>; // slackUrl → supabaseUrl

function loadProgress(): ProgressMap {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {};
}

function saveProgress(p: ProgressMap) {
  const dir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function fileKeyFromUrl(url: string): string {
  // Slack url_private 예: https://files.slack.com/files-pri/T06F9CR2W3A-F08M9EGF9DJ/screenshot.png
  //                                                     ^^^ workspace ^^^^ file_id
  // file_id 추출: 슬래시 또는 하이픈 다음에 오는 F + 대문자/숫자
  const m = url.match(/[-\/](F[A-Z0-9]{8,})(?=[\/\-?]|$)/);
  if (m) return `${m[1]}.webp`;
  // fallback: 마지막 segment를 안전한 이름으로 (충돌 방지를 위해 URL 해시 추가)
  const hash = require('crypto').createHash('md5').update(url).digest('hex').slice(0, 12);
  return `unknown-${hash}.webp`;
}

async function downloadImage(url: string, token: string): Promise<Buffer> {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 60000,
  });
  return Buffer.from(r.data);
}

async function main() {
  const slackToken = process.env.SLACK_BOT_TOKEN!;
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'slack-images';
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const sheets = new SheetsClient();
  const progress = loadProgress();

  // 1. 시트에서 URL 모으기
  console.log('1. 시트에서 이미지 URL 수집...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:K`);
  const dataRows = rows.slice(1);

  const allUrls = new Set<string>();
  for (const row of dataRows) {
    const urlsStr = row[9];
    if (!urlsStr) continue;
    try {
      const list = JSON.parse(urlsStr);
      if (Array.isArray(list)) list.forEach((u: string) => allUrls.add(u));
    } catch {}
  }
  const urlList = [...allUrls];
  console.log(`   총 고유 이미지: ${urlList.length}개`);

  // 이미 처리된 거 제외
  const toProcess = urlList.filter(u => !progress[u]);
  console.log(`   이미 처리됨: ${urlList.length - toProcess.length}, 남은 수: ${toProcess.length}\n`);

  // 2. 다운 + 변환 + 업로드 (병렬)
  let done = 0;
  let failed = 0;
  let totalOrig = 0;
  let totalWebP = 0;
  const startTime = Date.now();

  const queue = [...toProcess];

  const worker = async (workerId: number) => {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;

      try {
        const buf = await downloadImage(url, slackToken);
        totalOrig += buf.length;

        // WebP 최대 16383px 제한 — 큰 이미지는 리사이즈
        let pipeline = sharp(buf, { limitInputPixels: false });
        const meta = await pipeline.metadata();
        const maxDim = 16000;
        if ((meta.width ?? 0) > maxDim || (meta.height ?? 0) > maxDim) {
          pipeline = pipeline.resize({
            width: maxDim,
            height: maxDim,
            fit: 'inside',
            withoutEnlargement: true,
          });
        }
        const webp = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
        totalWebP += webp.length;

        const key = fileKeyFromUrl(url);
        const { error } = await supabase.storage
          .from(bucket)
          .upload(key, webp, {
            contentType: 'image/webp',
            upsert: true,
          });
        if (error) throw error;

        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(key);
        progress[url] = pub.publicUrl;

        done++;
        if (done % 20 === 0) {
          saveProgress(progress);
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = done / elapsed;
          const eta = (toProcess.length - done) / rate;
          process.stdout.write(
            `\r진행: ${done}/${toProcess.length} | 실패: ${failed} | ${rate.toFixed(1)}/s | ETA: ${(eta/60).toFixed(1)}분 `
          );
        }
      } catch (e: any) {
        failed++;
        console.error(`\n  ❌ ${url.slice(-50)}: ${e.message?.slice(0, 80)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  saveProgress(progress);

  console.log(`\n\n2. 시트 Image URLs 컬럼 업데이트...`);
  // 시트의 URL 배열에서 Slack URL → Supabase URL 치환
  const updatedRows: { rowIdx: number; newValue: string }[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const urlsStr = row[9];
    if (!urlsStr) continue;
    try {
      const list = JSON.parse(urlsStr);
      if (!Array.isArray(list)) continue;
      const newList = list.map((u: string) => progress[u] ?? u);
      const newStr = JSON.stringify(newList);
      if (newStr !== urlsStr) {
        updatedRows.push({ rowIdx: i + 2, newValue: newStr }); // 헤더 1행 + 1-indexed
      }
    } catch {}
  }

  console.log(`   업데이트할 행: ${updatedRows.length}개`);
  // 배치 업데이트: 한 번에 최대 500행씩 묶어서 전송
  const CHUNK = 500;
  for (let i = 0; i < updatedRows.length; i += CHUNK) {
    const chunk = updatedRows.slice(i, i + CHUNK);
    const updates = chunk.map(u => ({
      range: `'${tab}'!J${u.rowIdx}`,
      values: [[u.newValue]],
    }));
    await sheets.batchUpdate(spreadsheetId, updates);
    console.log(`   batch ${Math.floor(i / CHUNK) + 1} 완료 (${chunk.length}행)`);
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`총 처리:    ${done}장`);
  console.log(`실패:       ${failed}장`);
  console.log(`원본 용량:  ${(totalOrig / 1024 / 1024).toFixed(2)} MB`);
  console.log(`WebP 용량:  ${(totalWebP / 1024 / 1024).toFixed(2)} MB`);
  if (totalOrig > 0) {
    console.log(`압축률:     ${((1 - totalWebP/totalOrig) * 100).toFixed(1)}% 감소`);
  }
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`소요 시간:  ${elapsed}분`);
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
