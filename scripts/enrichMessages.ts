/**
 * Gemini로 메시지 enrich:
 *   - Category, Sub Category
 *   - 작품번호, 작품명, 작품매칭
 *   - 다중 작품 언급 시 각각 별도 행으로 추가 (Option 2)
 *
 * 사용:
 *   npx ts-node scripts/enrichMessages.ts                  # 전체
 *   npx ts-node scripts/enrichMessages.ts --limit=300      # 테스트
 *   npx ts-node scripts/enrichMessages.ts --reset          # progress 초기화
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';
import { SheetsClient } from '../src/services/sheets/SheetsClient';
import * as fs from 'fs';
import * as path from 'path';

const PROGRESS_FILE = path.resolve(process.cwd(), 'data', 'enrich-progress.json');
const BATCH_SIZE = 100;
const RPM = 10;                                          // gemini-2.5-flash 무료 티어 실제 한도
const REQ_INTERVAL_MS = Math.ceil(60_000 / RPM) + 500;  // 6.5초 간격
const MAX_BATCHES_PER_RUN = 40;                          // 일일 500 요청 한도 보호 (40배치 × 100 = 4000개/일)

const args = process.argv.slice(2);
const LIMIT = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const RESET = args.includes('--reset');

const PROMPT_HEADER = `당신은 한국어 글로벌 콘텐츠 운영 팀의 Slack 메시지를 분석합니다.
각 메시지마다 다음을 추출하세요:

A) CATEGORY (이슈 타입, 8가지 중 하나):
  원고/PSD | 일정/스케줄 | 메타/작가 | 라이센스/계약 | 현지화/번역 | BM/타입변경 | 런칭/오픈 | 기타

B) SUB CATEGORY (Category 내 세부):
  - 원고/PSD: "누락 페이지", "PSD 이슈", "로고 없음", "원고 수정", "원고 교체"
  - 일정/스케줄: "업로드 일정", "휴재", "연재 재개", "연재 중단", "오픈 일정"
  - 메타/작가: "작가 변경", "제목 변경", "시즌/외전", "시리즈 분류"
  - 라이센스/계약: "판권 종료", "서비스 종료"
  - 현지화/번역: "번역 중단", "언어별 이슈"
  - BM/타입변경: "BM 변경", "가격 변경", "타입/카테고리 변경"
  - 런칭/오픈: "신규 런칭", "무검열 런칭"
  - 기타: null 가능

C) 작품 목록 (메시지에서 언급된 모든 작품):
  - 각 작품의 번호(3-5자리 숫자)와 이름을 배열로 추출
  - 작품이 하나면 배열에 하나, 여럿이면 모두 포함
  - 작품을 찾을 수 없으면 [{"tn":null,"name":null}]

답글이면 "[부모: ...]" 텍스트도 활용해서 작품/맥락 파악하세요.
괄호/특수문자 무시: "(시즌2)", "[8730]" 등에서 핵심만 추출.

오직 JSON 배열로 답하세요. 마크다운/설명 금지.
단일 작품: [{"i":1,"c":"원고/PSD","sc":"누락 페이지","works":[{"tn":"8730","name":"부녀회장"}]},...]
다중 작품: [{"i":2,"c":"기타","sc":null,"works":[{"tn":"8071","name":"두근두근 공수교대"},{"tn":"9125","name":"다른작품"}]},...]
없음:     [{"i":3,"c":"기타","sc":null,"works":[{"tn":null,"name":null}]},...]

분류할 메시지:
`;

interface Item {
  rowIdx: number;    // 시트 행 번호 (2부터), M-Q 업데이트용
  permalink: string; // G컬럼, progress 키
  rowData: string[]; // 원본 A-L 데이터 (12컬럼), 추가 행 생성용
  isReply: boolean;
  sender: string;
  message: string;
  parentText: string;
}

interface AdditionalWork {
  titleNumber: string | null;
  titleName: string | null;
  titleMatch: '정확' | '이름매칭' | '번호매칭' | '유사' | '없음';
}

interface Enrichment {
  category: string | null;
  subCategory: string | null;
  titleNumber: string | null;
  titleName: string | null;
  titleMatch: '정확' | '이름매칭' | '번호매칭' | '유사' | '없음';
  additionalWorks?: AdditionalWork[];  // 2번째 작품 이후
  rowIdx: number;                      // 시트 행 번호 (저장용)
}

interface RawExtraction {
  category: string | null;
  subCategory: string | null;
  works: Array<{ tn: string | null; name: string | null }>;
}

// === DB 작품 매칭 ===

function normalize(s: string): string {
  return s
    .replace(/\[글로벌\s*전용\]/gi, '')   // [글로벌 전용] 전체 제거
    .replace(/\[.*?\]/g, '')               // 나머지 [...] 전체 제거
    .replace(/\(.*?\)/g, '')               // (...) 전체 제거
    .replace(/[{}「」『』〈〉【】<>"']/g, '')
    .replace(/시즌\s*\d+/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}

function buildTitleIndex(rows: string[][]) {
  const byNumber = new Map<string, string>(); // num → name
  const byNormName = new Map<string, { num: string; name: string }>();
  for (const r of rows.slice(1)) {
    const num = (r[0] ?? '').trim();
    const name = (r[1] ?? '').trim();
    if (num && name) {
      byNumber.set(num, name);
      byNormName.set(normalize(name), { num, name });
    }
  }
  return { byNumber, byNormName };
}

function matchWork(
  work: { tn: string | null; name: string | null },
  index: ReturnType<typeof buildTitleIndex>
): { num: string; name: string; conf: AdditionalWork['titleMatch'] } {
  const numRaw = work.tn?.replace(/[^0-9]/g, '') ?? '';
  const nameRaw = work.name ?? '';

  // 1) 둘 다 있고 DB에 둘 다 일치
  if (numRaw && nameRaw) {
    const dbName = index.byNumber.get(numRaw);
    const nmNorm = normalize(nameRaw);
    if (dbName && normalize(dbName) === nmNorm) {
      return { num: numRaw, name: dbName, conf: '정확' };
    }
    // 번호는 있는데 이름이 다르면 → 이름으로 다시 검색
    const byName = index.byNormName.get(nmNorm);
    if (byName) {
      return { num: byName.num, name: byName.name, conf: '이름매칭' };
    }
  }
  // 2) 이름만
  if (nameRaw) {
    const nmNorm = normalize(nameRaw);
    const byName = index.byNormName.get(nmNorm);
    if (byName) return { num: byName.num, name: byName.name, conf: '이름매칭' };
    // 퍼지: 가장 가까운 이름 (distance <= 2 또는 길이의 20% 이하)
    let best: { num: string; name: string; dist: number } | null = null;
    for (const [norm, entry] of index.byNormName) {
      const d = levenshtein(nmNorm, norm);
      const threshold = Math.max(2, Math.floor(norm.length * 0.2));
      if (d <= threshold && (!best || d < best.dist)) {
        best = { num: entry.num, name: entry.name, dist: d };
      }
    }
    if (best) return { num: best.num, name: best.name, conf: '유사' };
  }
  // 3) 번호만 → DB에 있는지
  if (numRaw && index.byNumber.has(numRaw)) {
    return { num: numRaw, name: index.byNumber.get(numRaw)!, conf: '번호매칭' };
  }
  return { num: '', name: '', conf: '없음' };
}

// === 메인 ===

function loadProgress(): Record<string, Enrichment> {
  if (RESET && fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  return {};
}

function saveProgress(p: Record<string, Enrichment>) {
  const dir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function callGemini(model: any, batch: Item[], maxRetries = 4): Promise<Map<string, RawExtraction>> {
  const lines = batch.map((it, i) => {
    const role = it.isReply ? '답글' : '메시지';
    const parent = it.parentText ? ` [부모: ${it.parentText.slice(0, 100)}]` : '';
    return `[${i+1}] ${role}(${it.sender}): "${it.message.slice(0, 300)}"${parent}`;
  });

  const prompt = PROMPT_HEADER + lines.join('\n');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) throw new Error(`No JSON: ${text.slice(0, 200)}`);
      const parsed = JSON.parse(m[0]);

      const out = new Map<string, RawExtraction>();
      for (const p of parsed) {
        const it = batch[(p.i ?? 0) - 1];
        if (!it) continue;

        // works 배열 파싱 (신규 형식 우선, 구형 tn/name 폴백)
        let works: Array<{ tn: string | null; name: string | null }>;
        if (Array.isArray(p.works) && p.works.length > 0) {
          works = p.works.map((w: any) => ({ tn: w.tn ?? null, name: w.name ?? null }));
        } else {
          works = [{ tn: p.tn ?? null, name: p.name ?? null }];
        }

        out.set(it.permalink, {
          category: p.c ?? null,
          subCategory: p.sc ?? null,
          works,
        });
      }
      return out;
    } catch (e: any) {
      const isQuota = e?.status === 429 || (e?.message ?? '').includes('429') ||
        (e?.message ?? '').includes('quota') || (e?.message ?? '').includes('RESOURCE_EXHAUSTED');
      if (attempt < maxRetries) {
        const waitMs = isQuota
          ? (attempt + 1) * 30_000   // 할당량 초과: 30초씩 증가
          : Math.min(1000 * 2 ** attempt, 16_000);  // 일반 오류: 지수 백오프
        console.error(`\n  Gemini 오류 (시도 ${attempt + 1}/${maxRetries + 1}): ${e.message?.slice(0, 80)} → ${waitMs / 1000}초 대기`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error('callGemini: max retries exceeded');
}

function loadGoogleCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (b64) {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (keyPath) {
    return JSON.parse(fs.readFileSync(require('path').resolve(keyPath), 'utf-8'));
  }
  throw new Error('No Google credentials (KEY_BASE64 or KEY_PATH)');
}

async function ensureHeaders(spreadsheetId: string, tab: string) {
  const credentials = loadGoogleCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!M1:Q1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Category','Sub Category','작품번호','작품명','작품매칭']] },
  });
}

async function main() {
  const runStart = new Date();
  let classifiedCount = 0;
  let failedBatches = 0;

  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });

  const sheets = new SheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';
  const logTab = process.env.GOOGLE_SHEETS_LOG_TAB ?? 'Slack 로그';

  console.log('1. 작품 DB 로드...');
  const dbRows = await sheets.getRange(spreadsheetId, `'작품정보'!A:B`);
  const titleIndex = buildTitleIndex(dbRows);
  console.log(`   ${titleIndex.byNumber.size}개 작품 인덱스 구축`);

  console.log('\n2. 시트 데이터 읽기...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:L`);
  const dataRows = rows.slice(1);
  console.log(`   ${dataRows.length}행`);

  // permalink별 기존 행 수 카운트 (중복 행 추가 방지용)
  const permalinkCount = new Map<string, number>();
  for (const r of dataRows) {
    const pl = (r[6] ?? '').trim();
    if (pl) permalinkCount.set(pl, (permalinkCount.get(pl) ?? 0) + 1);
  }

  // permalink → Item 맵 (추가 행 생성 시 원본 데이터 조회용)
  // 동일 permalink의 첫 번째 행(rowIdx 최솟값)만 사용
  const itemByPermalink = new Map<string, Item>();
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowIdx = i + 2;
    const permalink = (r[6] ?? '').trim();
    if (!permalink) continue;
    if (!itemByPermalink.has(permalink)) {
      // 최초 등장 행만 저장 (원본)
      itemByPermalink.set(permalink, {
        rowIdx,
        permalink,
        rowData: r.slice(0, 12),
        isReply: r[0] === 'TRUE',
        sender: r[2] ?? '',
        message: (r[5] ?? '').trim(),
        parentText: r[7] ?? '',
      });
    }
  }

  const progress = loadProgress();

  // 아직 처리 안 된 고유 permalink 목록으로 items 구성
  let items: Item[] = [];
  for (const [permalink, item] of itemByPermalink) {
    if (progress[permalink]) continue;  // 이미 처리됨
    if (!item.message) {
      // 메시지 없는 행은 기타로 즉시 처리
      progress[permalink] = {
        category: '기타', subCategory: null,
        titleNumber: null, titleName: null, titleMatch: '없음',
        rowIdx: item.rowIdx,
      };
      continue;
    }
    items.push(item);
  }

  if (LIMIT) items = items.slice(0, Number(LIMIT));
  console.log(`   처리 대상: ${items.length}개 (이미 처리: ${Object.keys(progress).length})`);

  console.log('\n3. 헤더 보장...');
  await ensureHeaders(spreadsheetId, tab);

  const maxItems = MAX_BATCHES_PER_RUN * BATCH_SIZE;
  if (items.length > maxItems) {
    console.log(`   ⚠️ 일일 할당량 보호: ${items.length}개 중 ${maxItems}개만 처리 (나머지는 내일 계속)`);
    items = items.slice(0, maxItems);
  }

  console.log(`\n4. Gemini 분류 (배치 ${BATCH_SIZE}, 분당 ${RPM})...`);
  const start = Date.now();
  let consecutiveFails = 0;
  // 이번 실행에서 새로 처리된 항목 (추가 행 append용)
  const newlyProcessed = new Map<string, Enrichment>();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const t0 = Date.now();
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const raws = await callGemini(model, batch);
      for (const [permalink, raw] of raws) {
        // 첫 번째 작품 매칭
        const firstWork = raw.works[0] ?? { tn: null, name: null };
        const { num, name, conf } = matchWork(firstWork, titleIndex);

        // 추가 작품 매칭 (2번째 이후)
        const additionalWorks: AdditionalWork[] = raw.works.slice(1).map(w => {
          const { num: n, name: nm, conf: c } = matchWork(w, titleIndex);
          return { titleNumber: n || null, titleName: nm || null, titleMatch: c };
        });

        const item = itemByPermalink.get(permalink);
        if (!item) continue;

        const enrichment: Enrichment = {
          category: raw.category,
          subCategory: raw.subCategory,
          titleNumber: num || null,
          titleName: name || null,
          titleMatch: conf,
          additionalWorks: additionalWorks.length > 0 ? additionalWorks : undefined,
          rowIdx: item.rowIdx,
        };

        progress[permalink] = enrichment;
        newlyProcessed.set(permalink, enrichment);
        classifiedCount++;
      }
      saveProgress(progress);
      consecutiveFails = 0;
    } catch (e: any) {
      failedBatches++;
      consecutiveFails++;
      console.error(`\n  배치 ${i/BATCH_SIZE+1} 실패: ${e.message?.slice(0, 100)}`);
      // 연속 5회 실패 시 할당량 소진으로 판단, 조기 종료
      if (consecutiveFails >= 5) {
        console.error(`\n  ❌ 연속 ${consecutiveFails}회 실패 → 일일 할당량 소진. 오늘 실행 중단. 내일 재개됩니다.`);
        break;
      }
    }
    const done = i + batch.length;
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const eta = (items.length - done) / rate / 60;
    process.stdout.write(`\r   진행: ${done}/${items.length} | ETA: ${eta.toFixed(1)}분  `);
    const used = Date.now() - t0;
    if (used < REQ_INTERVAL_MS && i + BATCH_SIZE < items.length) {
      await new Promise(r => setTimeout(r, REQ_INTERVAL_MS - used));
    }
  }

  // === 5. 시트 업데이트: M~Q 컬럼 (기존 행) ===
  console.log('\n\n5. 시트 업데이트 (M~Q 컬럼, batch)...');
  const updates: { range: string; values: string[][] }[] = [];
  for (const [_key, e] of Object.entries(progress)) {
    if (!e.rowIdx) continue;  // 구버전 progress(rowIdx 없음) 호환성
    updates.push({
      range: `'${tab}'!M${e.rowIdx}:Q${e.rowIdx}`,
      values: [[
        e.category ?? '',
        e.subCategory ?? '',
        e.titleNumber ?? '',
        e.titleName ?? '',
        e.titleMatch,
      ]],
    });
  }
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await sheets.batchUpdate(spreadsheetId, updates.slice(i, i + CHUNK));
    console.log(`   batch ${Math.floor(i/CHUNK)+1} 완료`);
  }

  // === 6. 추가 작품 행 append (다중 작품 언급 시) ===
  const extraRowsToAppend: string[][] = [];
  let multiWorkCount = 0;

  for (const [permalink, e] of newlyProcessed) {
    if (!e.additionalWorks || e.additionalWorks.length === 0) continue;

    // 이미 추가 행이 존재하면 skip (중복 방지 — progress 유실 시 대비)
    const existingCount = permalinkCount.get(permalink) ?? 1;
    if (existingCount > 1) {
      console.log(`   skip duplicate extra rows for ${permalink} (already ${existingCount} rows)`);
      continue;
    }

    const origItem = itemByPermalink.get(permalink);
    if (!origItem) continue;

    for (const aw of e.additionalWorks) {
      // A-L: 원본 행 데이터 복사, M-Q: 추가 작품 분류
      const newRow: string[] = [
        ...Array.from({ length: 12 }, (_, j) => origItem.rowData[j] ?? ''),
        e.category ?? '',
        e.subCategory ?? '',
        aw.titleNumber ?? '',
        aw.titleName ?? '',
        aw.titleMatch,
      ];
      extraRowsToAppend.push(newRow);
    }
    multiWorkCount++;
  }

  if (extraRowsToAppend.length > 0) {
    console.log(`\n6. 다중 작품 추가 행 ${extraRowsToAppend.length}개 append (${multiWorkCount}개 메시지)...`);
    await sheets.appendRows(spreadsheetId, `'${tab}'`, extraRowsToAppend);
    console.log(`   완료`);
  } else {
    console.log(`\n6. 다중 작품 추가 행 없음`);
  }

  // 통계
  const stats = {
    category: {} as Record<string, number>,
    match: {} as Record<string, number>,
  };
  for (const e of Object.values(progress)) {
    stats.category[e.category ?? '없음'] = (stats.category[e.category ?? '없음'] ?? 0) + 1;
    stats.match[e.titleMatch] = (stats.match[e.titleMatch] ?? 0) + 1;
  }
  console.log('\n═══ Category 분포 ═══');
  Object.entries(stats.category).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log('\n═══ 작품 매칭 ═══');
  Object.entries(stats.match).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  if (extraRowsToAppend.length > 0) {
    console.log(`\n═══ 다중 작품 ═══`);
    console.log(`  다중 작품 메시지: ${multiWorkCount}개`);
    console.log(`  추가된 행: ${extraRowsToAppend.length}개`);
  }

  // === 로그 탭에 실행 기록 추가 ===
  const writer = new (await import('../src/services/sheets/SheetsWriter')).SheetsWriter(sheets);
  await writer.appendEnrichLogRow(spreadsheetId, logTab, {
    startedAt: runStart,
    finishedAt: new Date(),
    classified: classifiedCount,
    failed: failedBatches,
  });
}

main().catch(e => { console.error(e); process.exit(1); });
