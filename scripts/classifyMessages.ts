/**
 * Gemini API로 시트 메시지를 Level 1-5 + Level 4 subcategory로 분류
 * - 50개씩 batch
 * - 분당 15회 rate limit 준수
 * - 진행 상황 저장 (재시작 가능)
 * - 결과: 시트에 새 컬럼 추가 (Level, Subcategory)
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';
import { SheetsClient } from '../src/services/sheets/SheetsClient';
import * as fs from 'fs';
import * as path from 'path';

const PROGRESS_FILE = path.resolve(process.cwd(), 'data', 'classification-progress.json');
const BATCH_SIZE = 50;
const RPM = 15; // 분당 요청 한도
const REQ_INTERVAL_MS = Math.ceil(60_000 / RPM) + 200;

const CLASSIFICATION_PROMPT = `
You are classifying Slack messages from a Korean global webtoon localization team's "작품관련소통" channel.

Use this 5-level hierarchy. For Level 4, also assign one of 5 subcategories.

LEVEL 1 — Pre-Pipeline / Intake Information (작품관리대장 등록 전)
- 신규 작품 계약, G-Admin 등록 안내, 계약 검토, 서지 전달, 런칭 준비

LEVEL 2 — Global Operational Information
- 정책/워크플로우/언어 전체 설정 등 모든 작품에 영향. 운영정책서 대상

LEVEL 3 — Cross-title Operational Notices
- 여러 작품에 영향을 미치는 일시적 운영 공지. 예: BM/카테고리/가격 일괄 변경, 무검열 작품 런칭일 공지

LEVEL 4 — Title-Specific Information (특정 작품 1개)
Subcategories:
  4-1 (Publishing & Scheduling): 업로드 일정, 휴재, 연재 재개, 연재 중단, 오픈 일정 변경
  4-2 (Licensing & Service Status): 판권 종료, 서비스 종료
  4-3 (Manuscript / Asset Issues): 누락 페이지/이미지, PSD 이슈, 타이틀 로고 없음, 원고 수정/교체
  4-4 (Metadata & Catalog): 작가 변경, 제목 변경, 시리즈 분류 변경, 시즌/외전
  4-5 (Localization Production): 현지화 작업 중단, 언어별 이슈

LEVEL 5 — Slack-Only / Non-Archival
- 일시적 잡담, 가벼운 조율, 장기 참조 가치 없는 대화

Classify each message. Output ONLY a JSON array. No markdown, no explanation.

Format: [{"i":1,"level":4,"sub":"4-1"},{"i":2,"level":5,"sub":null}, ...]

- "i" = the index I gave you
- "level" = 1|2|3|4|5
- "sub" = "4-1"|"4-2"|"4-3"|"4-4"|"4-5" only if level=4, else null
- If unclear, prefer Level 5
- If a message has "[봇/시스템 메시지]" as parent context, classify on the reply content itself

Messages to classify (each starts with index):
`;

interface RowToClassify {
  rowIdx: number; // 2-indexed sheet row
  isReply: boolean;
  sender: string;
  message: string;
  parentText: string;
}

interface Classification {
  level: number;
  sub: string | null;
}

function loadProgress(): Record<number, Classification> {
  if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  return {};
}

function saveProgress(p: Record<number, Classification>) {
  const dir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function classifyBatch(
  model: any,
  batch: RowToClassify[]
): Promise<Map<number, Classification>> {
  const lines = batch.map((r, idx) => {
    const role = r.isReply ? '답글' : '메시지';
    const parent = r.parentText ? ` [부모: ${r.parentText.slice(0, 60)}]` : '';
    return `[${idx + 1}] ${role} (${r.sender}): "${r.message.slice(0, 300)}"${parent}`;
  });

  const prompt = CLASSIFICATION_PROMPT + '\n' + lines.join('\n');

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // JSON 추출
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  const parsed: Array<{ i: number; level: number; sub: string | null }> = JSON.parse(jsonMatch[0]);

  const out = new Map<number, Classification>();
  for (const c of parsed) {
    const item = batch[c.i - 1];
    if (item) out.set(item.rowIdx, { level: c.level, sub: c.sub });
  }
  return out;
}

async function ensureColumns(spreadsheetId: string, tab: string) {
  // M, N 컬럼 추가 ("Level", "Subcategory")
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!;
  const credentials = JSON.parse(fs.readFileSync(require('path').resolve(keyPath), 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!M1:N1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Level', 'Subcategory']] },
  });
}

async function main() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY missing');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });

  const sheets = new SheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  console.log('1. 시트 읽기...');
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:L`);
  const dataRows = rows.slice(1);
  console.log(`   ${dataRows.length}행`);

  const progress = loadProgress();
  const allToClassify: RowToClassify[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowIdx = i + 2;
    if (progress[rowIdx]) continue; // 이미 분류됨
    const msg = (r[5] ?? '').trim();
    if (!msg) {
      progress[rowIdx] = { level: 5, sub: null }; // 빈 메시지 = Level 5
      continue;
    }
    allToClassify.push({
      rowIdx,
      isReply: r[0] === 'TRUE',
      sender: r[2] ?? '',
      message: msg,
      parentText: r[7] ?? '',
    });
  }
  console.log(`   분류 대상: ${allToClassify.length}개 (이미 처리: ${Object.keys(progress).length})`);

  console.log('\n2. M/N 컬럼 헤더 보장...');
  await ensureColumns(spreadsheetId, tab);

  console.log('\n3. Gemini로 분류 시작 (50개씩, 분당 15회)...');
  const start = Date.now();
  for (let i = 0; i < allToClassify.length; i += BATCH_SIZE) {
    const batchStart = Date.now();
    const batch = allToClassify.slice(i, i + BATCH_SIZE);
    try {
      const results = await classifyBatch(model, batch);
      for (const [rowIdx, c] of results) progress[rowIdx] = c;
      saveProgress(progress);
    } catch (e: any) {
      console.error(`\n   배치 ${i/BATCH_SIZE + 1} 실패: ${e.message?.slice(0, 100)}`);
      // 실패한 배치는 일단 skip; 나중에 재실행
    }

    const done = i + batch.length;
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const eta = (allToClassify.length - done) / rate / 60;
    process.stdout.write(`\r   진행: ${done}/${allToClassify.length} | ETA: ${eta.toFixed(1)}분  `);

    // RPM 준수: 다음 요청까지 대기
    const used = Date.now() - batchStart;
    if (used < REQ_INTERVAL_MS && i + BATCH_SIZE < allToClassify.length) {
      await new Promise(r => setTimeout(r, REQ_INTERVAL_MS - used));
    }
  }

  console.log('\n\n4. 시트에 결과 쓰기 (M/N 컬럼)...');
  const sheetUpdates: { range: string; values: string[][] }[] = [];
  for (const [rowIdxStr, c] of Object.entries(progress)) {
    const rowIdx = Number(rowIdxStr);
    sheetUpdates.push({
      range: `'${tab}'!M${rowIdx}:N${rowIdx}`,
      values: [[String(c.level), c.sub ?? '']],
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < sheetUpdates.length; i += CHUNK) {
    const chunk = sheetUpdates.slice(i, i + CHUNK);
    await sheets.batchUpdate(spreadsheetId, chunk);
    console.log(`   batch ${Math.floor(i/CHUNK)+1} 완료 (${chunk.length}건)`);
  }

  // 통계
  const counts: Record<string, number> = {};
  for (const c of Object.values(progress)) {
    const key = c.sub ? `Level ${c.level} (${c.sub})` : `Level ${c.level}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log('\n═══════════════════════════════════════');
  console.log('  분류 통계');
  console.log('═══════════════════════════════════════');
  for (const [k, v] of Object.entries(counts).sort()) {
    console.log(`  ${k}: ${v}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
