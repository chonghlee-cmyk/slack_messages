import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';

async function main() {
  const sheets = new SheetsClient();
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = '작품정보';

  const rows = await sheets.getRange(id, `'${tab}'!A:B`);
  console.log(`총 ${rows.length}행 (헤더 포함)`);

  if (rows.length > 0) console.log('헤더:', rows[0]);
  console.log('\n샘플 (앞 5개):');
  rows.slice(1, 6).forEach((r, i) => console.log(`  [${i+1}] 번호=${r[0]} | 이름=${r[1]}`));

  console.log('\n샘플 (끝 5개):');
  rows.slice(-5).forEach((r, i) => console.log(`  [${rows.length-5+i}] 번호=${r[0]} | 이름=${r[1]}`));

  const valid = rows.slice(1).filter(r => r[0] && r[1]).length;
  console.log(`\n유효 (번호+이름 둘 다): ${valid}개`);
}
main().catch(e => console.error(e));
