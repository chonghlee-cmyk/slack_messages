/**
 * 두 Gemini 모델 비교: gemini-2.5-flash vs gemini-2.5-flash-lite
 * 시트에서 메시지 30개 샘플링 → 같은 프롬프트로 분류 → 결과 비교
 *
 * 사용: npx ts-node scripts/compareGeminiModels.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import { SheetsClient } from '../src/services/sheets/SheetsClient';

const SAMPLE_SIZE = 30;
const PROMPT_HEADER = `당신은 한국어 글로벌 콘텐츠 운영 팀의 Slack 메시지를 분석합니다.
각 메시지마다 다음을 추출하세요:

A) CATEGORY (8가지 중 하나):
  원고/PSD | 일정/스케줄 | 메타/작가 | 라이센스/계약 | 현지화/번역 | BM/타입변경 | 런칭/오픈 | 기타

B) SUB CATEGORY: 자유 추출

C) 작품번호 (3-5자리 숫자, 못 찾으면 null)
D) 작품명 (못 찾으면 null)

오직 JSON 배열로: [{"i":1,"c":"원고/PSD","sc":"누락","tn":"8730","name":"부녀회장"},...]

분류할 메시지:
`;

async function classify(modelName: string, batch: string[]): Promise<any[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });

  const lines = batch.map((msg, i) => `[${i+1}] "${msg.slice(0, 300)}"`).join('\n');
  const start = Date.now();
  const result = await model.generateContent(PROMPT_HEADER + lines);
  const elapsed = Date.now() - start;
  const text = result.response.text();
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('No JSON');
  return [JSON.parse(m[0]), elapsed];
}

async function main() {
  const sheets = new SheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  console.log(`1. 시트에서 메시지 ${SAMPLE_SIZE}개 샘플링...`);
  const rows = await sheets.getRange(spreadsheetId, `'${tab}'!A:L`);
  const messages: string[] = [];
  for (const r of rows.slice(1)) {
    const msg = (r[5] ?? '').trim();
    if (msg.length > 10) messages.push(msg);
    if (messages.length >= SAMPLE_SIZE) break;
  }
  console.log(`   ${messages.length}개 수집됨\n`);

  console.log('2. gemini-2.5-flash 분류...');
  const [r1, t1] = await classify('gemini-2.5-flash', messages) as [any[], number];
  console.log(`   완료 (${(t1/1000).toFixed(1)}초)\n`);

  console.log('3. gemini-2.5-flash-lite 분류...');
  const [r2, t2] = await classify('gemini-2.5-flash-lite', messages) as [any[], number];
  console.log(`   완료 (${(t2/1000).toFixed(1)}초)\n`);

  // 비교
  console.log('═══ 결과 비교 ═══\n');
  let agreeCat = 0, agreeSub = 0, agreeWork = 0;
  for (let i = 0; i < messages.length; i++) {
    const a = r1.find((x: any) => x.i === i+1);
    const b = r2.find((x: any) => x.i === i+1);
    if (!a || !b) continue;

    const catSame = a.c === b.c;
    const subSame = (a.sc ?? '') === (b.sc ?? '');
    const workSame = (a.tn ?? '') === (b.tn ?? '') && (a.name ?? '') === (b.name ?? '');
    if (catSame) agreeCat++;
    if (subSame) agreeSub++;
    if (workSame) agreeWork++;

    if (!catSame || !workSame) {
      console.log(`[${i+1}] ${messages[i].slice(0, 60)}...`);
      console.log(`     flash:      c=${a.c} sc=${a.sc} tn=${a.tn} name=${a.name}`);
      console.log(`     flash-lite: c=${b.c} sc=${b.sc} tn=${b.tn} name=${b.name}`);
      console.log(`     ${catSame ? '✓' : '✗'} category, ${workSame ? '✓' : '✗'} work\n`);
    }
  }

  console.log('═══ 일치율 ═══');
  console.log(`  Category:    ${agreeCat}/${messages.length} (${(agreeCat/messages.length*100).toFixed(0)}%)`);
  console.log(`  SubCategory: ${agreeSub}/${messages.length} (${(agreeSub/messages.length*100).toFixed(0)}%)`);
  console.log(`  작품 매칭:   ${agreeWork}/${messages.length} (${(agreeWork/messages.length*100).toFixed(0)}%)`);
  console.log('\n═══ 속도 ═══');
  console.log(`  flash:      ${(t1/1000).toFixed(1)}초`);
  console.log(`  flash-lite: ${(t2/1000).toFixed(1)}초`);
}

main().catch(e => { console.error(e); process.exit(1); });
