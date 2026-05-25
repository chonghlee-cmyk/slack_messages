import * as dotenv from 'dotenv';
dotenv.config();

import { SheetsClient } from '../src/services/sheets/SheetsClient';

async function main() {
  const sheets = new SheetsClient();
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const tab = process.env.GOOGLE_SHEETS_OUTPUT_TAB ?? 'Slack';

  const rows = await sheets.getRange(id, `'${tab}'!A:K`);
  const data = rows.slice(1);

  let slackCount = 0, supabaseCount = 0, totalUrls = 0;
  for (const row of data) {
    const urls = row[9];
    if (!urls) continue;
    try {
      const list = JSON.parse(urls);
      for (const u of list) {
        totalUrls++;
        if (u.includes('files.slack.com') || u.includes('slack-files.com')) slackCount++;
        else if (u.includes('supabase')) supabaseCount++;
      }
    } catch {}
  }
  console.log(`총 URL: ${totalUrls}`);
  console.log(`Slack URL: ${slackCount}`);
  console.log(`Supabase URL: ${supabaseCount}`);
}
main().catch(e => console.error(e));
