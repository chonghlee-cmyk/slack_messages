import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const genAI = new GoogleGenerativeAI(apiKey);

  const names = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-002',
  ];
  for (const name of names) {
    try {
      console.log(`\n[${name}]`);
      const model = genAI.getGenerativeModel({ model: name });
      const result = await model.generateContent('Say OK');
      console.log(`  ✅ ${result.response.text().trim()}`);
      return;
    } catch (e: any) {
      console.log(`  ❌ ${e.message}`);
    }
  }
}
main().catch(e => console.error(e));
