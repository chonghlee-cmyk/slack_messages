import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });

  try {
    const r = await model.generateContent('Reply with JSON: {"ok":true}');
    console.log('✅', r.response.text());
  } catch (e: any) {
    console.log('❌ FULL ERROR:', e.message);
  }
}
main();
