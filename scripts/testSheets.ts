/**
 * Phase 0 검증 스크립트
 * Google Sheets에서 작품 목록을 읽어 콘솔에 출력합니다.
 *
 * 실행: npm run script:test-sheets
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';
import { SheetsReader } from '../src/services/sheets/SheetsReader';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const artworkTab = process.env.GOOGLE_SHEETS_ARTWORK_TAB ?? '작품관리대장 2.0';
  const nameColumn = Number(process.env.GOOGLE_SHEETS_ARTWORK_NAME_COLUMN ?? '0');

  if (!spreadsheetId) {
    console.error('\n❌ 오류: GOOGLE_SHEETS_SPREADSHEET_ID가 .env에 설정되어 있지 않습니다.');
    console.error('   .env.example을 참고해서 .env 파일을 만들어 주세요.\n');
    process.exit(1);
  }

  console.log('\n──────────────────────────────────────────');
  console.log('  Google Sheets 연결 테스트');
  console.log('──────────────────────────────────────────');
  console.log(`  스프레드시트 ID : ${spreadsheetId}`);
  console.log(`  탭 이름         : ${artworkTab}`);
  console.log(`  작품명 열       : ${nameColumn} (${String.fromCharCode(65 + nameColumn)}열)`);
  console.log('──────────────────────────────────────────\n');

  const client = new SheetsClient();
  const reader = new SheetsReader(client);

  console.log('⏳ Google Sheets에 연결 중...\n');

  const artworks = await reader.readArtworks(spreadsheetId, artworkTab, nameColumn);

  if (artworks.length === 0) {
    console.log(`⚠️  "${artworkTab}" 탭에서 작품을 찾지 못했습니다.`);
    console.log('   탭 이름과 작품명 열 번호를 확인해 주세요.\n');
    process.exit(0);
  }

  console.log(`✅ Google Sheets 연결 성공! 작품 ${artworks.length}개 발견:\n`);

  artworks.forEach(({ name, sheetRowIndex }, idx) => {
    const num = String(idx + 1).padStart(3, ' ');
    console.log(`  [${num}] ${name}  (행 ${sheetRowIndex})`);
  });

  console.log('\n──────────────────────────────────────────');
  console.log(`  총 ${artworks.length}개 작품 확인 완료`);
  console.log('──────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n❌ 오류 발생:\n');
  if (err instanceof Error) {
    console.error(err.message);
    if (process.env.LOG_LEVEL === 'debug') {
      console.error('\n스택 트레이스:');
      console.error(err.stack);
    }
  } else {
    console.error(err);
  }
  console.error('');
  process.exit(1);
});
