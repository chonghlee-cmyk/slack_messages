/**
 * 외부 작품 DB → HUB "작품정보" 탭으로 복사
 * - 소스: 1V-lMYW4n... / "작품" 탭 / C4: 작품번호, D4: 작품명
 * - 대상: HUB 시트 / "작품정보" 탭 / A=작품번호, B=작품명
 *
 * 주기적으로 실행하면 동기화됨 (기존 데이터 덮어씀)
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';

const SOURCE_SHEET_ID = '1V-lMYW4nZIKtUdqJYhNEaNRYv29IPCUpxfYZPaU6yfk';
const SOURCE_TAB = '작품';
const TARGET_TAB = '작품정보';

async function main() {
  const sheets = new SheetsClient();
  const targetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

  console.log(`1. 소스에서 작품번호/작품명 읽기...`);
  // C4부터 끝까지 작품번호, D4부터 작품명
  const numbers = await sheets.getRange(SOURCE_SHEET_ID, `'${SOURCE_TAB}'!C4:C`);
  const names = await sheets.getRange(SOURCE_SHEET_ID, `'${SOURCE_TAB}'!D4:D`);

  const rows: string[][] = [];
  const maxLen = Math.max(numbers.length, names.length);
  for (let i = 0; i < maxLen; i++) {
    const num = (numbers[i]?.[0] ?? '').trim();
    const name = (names[i]?.[0] ?? '').trim();
    if (num || name) rows.push([num, name]);
  }
  console.log(`   읽음: ${rows.length}개 작품`);

  console.log(`\n2. HUB "${TARGET_TAB}" 탭 보장 + 기존 데이터 클리어...`);
  await sheets.ensureTabExists(targetId, TARGET_TAB);
  await sheets.clearRange(targetId, `'${TARGET_TAB}'!A:Z`);

  console.log(`\n3. 헤더 + 데이터 쓰기...`);
  const HEADER = [['작품번호', '작품명']];
  await sheets.updateRange(targetId, `'${TARGET_TAB}'!A1:B1`, HEADER);

  // 배치로 데이터 쓰기 (500행씩)
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const startRow = i + 2; // 1행은 헤더
    const endRow = startRow + chunk.length - 1;
    await sheets.updateRange(targetId, `'${TARGET_TAB}'!A${startRow}:B${endRow}`, chunk);
    console.log(`   ${endRow - 1}/${rows.length} 행 완료`);
  }

  // 통계
  let bothCount = 0, numOnly = 0, nameOnly = 0;
  for (const r of rows) {
    if (r[0] && r[1]) bothCount++;
    else if (r[0]) numOnly++;
    else nameOnly++;
  }
  console.log(`\n═══════════════════════════════════════`);
  console.log(`총 ${rows.length}개`);
  console.log(`  번호+이름 모두: ${bothCount}`);
  console.log(`  번호만: ${numOnly}`);
  console.log(`  이름만: ${nameOnly}`);
  console.log(`═══════════════════════════════════════`);
  console.log(`✅ HUB "${TARGET_TAB}" 탭 동기화 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
