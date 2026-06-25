import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { logger } from '../../utils/logger';

type SheetsApi = sheets_v4.Sheets;

export class SheetsClient {
  private sheets: SheetsApi | null = null;

  private async getSheets(): Promise<SheetsApi> {
    if (this.sheets) return this.sheets;

    const auth = await this.createAuth();
    this.sheets = google.sheets({ version: 'v4', auth });
    return this.sheets;
  }

  private async createAuth() {
    const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

    let credentials: object;

    if (keyBase64) {
      const json = Buffer.from(keyBase64, 'base64').toString('utf-8');
      const parsed = JSON.parse(json);
      // 레거시 토큰 엔드포인트(www.googleapis.com/oauth2/v4/token) → 최신 엔드포인트로 교체
      if (typeof parsed.token_uri === 'string' && parsed.token_uri.includes('www.googleapis.com')) {
        parsed.token_uri = 'https://oauth2.googleapis.com/token';
      }
      credentials = parsed;
      logger.debug('Google auth: using base64 key');
    } else if (keyPath) {
      const resolved = require('path').resolve(keyPath);
      if (!fs.existsSync(resolved)) {
        throw new Error(
          `Service account key file not found: ${resolved}\n` +
          `Check GOOGLE_SERVICE_ACCOUNT_KEY_PATH in your .env file.`
        );
      }
      credentials = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      logger.debug({ keyPath: resolved }, 'Google auth: using file key');
    } else {
      throw new Error(
        'No Google credentials found.\n' +
        'Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 in your .env file.'
      );
    }

    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isQuota =
          err?.code === 429 ||
          err?.status === 429 ||
          (err?.message ?? '').includes('Quota exceeded') ||
          (err?.message ?? '').includes('RESOURCE_EXHAUSTED');

        if (isQuota && attempt < maxRetries) {
          const waitMs = Math.min(1000 * 2 ** attempt, 64000) + Math.floor(Math.random() * 1000);
          logger.warn({ attempt, waitMs }, 'Sheets quota exceeded — retrying');
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Sheets: max retries exceeded');
  }

  async getRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, range }, 'Sheets getRange');

    const response = await this.withRetry(() =>
      sheets.spreadsheets.values.get({ spreadsheetId, range })
    );

    return (response.data.values as string[][] | null | undefined) ?? [];
  }

  /**
   * 큰 범위를 청크로 안전하게 읽기 (예: 'Slack'!A:L → 5000행씩)
   * tabName 기반으로 행 청크를 만들어 GA 환경에서도 안정적
   */
  async getRangeChunked(
    spreadsheetId: string,
    tabName: string,
    columns: string,                // 예: 'A:L'
    chunkSize: number = 5000
  ): Promise<string[][]> {
    const all: string[][] = [];
    let startRow = 1;
    while (true) {
      const endRow = startRow + chunkSize - 1;
      // 컬럼 prefix 분리: 'A:L' → 'A', 'L'
      const [colStart, colEnd] = columns.split(':');
      const range = `'${tabName}'!${colStart}${startRow}:${colEnd}${endRow}`;
      const chunk = await this.getRange(spreadsheetId, range);
      if (chunk.length === 0) break;
      all.push(...chunk);
      logger.debug({ tabName, startRow, endRow, got: chunk.length, total: all.length }, 'Chunked read');
      if (chunk.length < chunkSize) break;  // 마지막 청크
      startRow = endRow + 1;
    }
    return all;
  }

  async appendRows(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<void> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, range, rowCount: values.length }, 'Sheets appendRows');

    await this.withRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        // RAW: 텍스트 그대로 저장 (날짜/숫자 자동 변환 방지)
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      })
    );
  }

  async updateRange(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<void> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, range, rowCount: values.length }, 'Sheets updateRange');

    await this.withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      })
    );
  }

  async ensureTabExists(spreadsheetId: string, tabName: string): Promise<void> {
    const sheets = await this.getSheets();

    // 현재 시트 목록 조회
    const meta = await this.withRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })
    );
    const existing = (meta.data.sheets ?? []).map(s => s.properties?.title);
    if (existing.includes(tabName)) return;

    await this.withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      })
    );
    logger.info({ tabName }, 'Sheet tab created');
  }

  async batchUpdate(
    spreadsheetId: string,
    updates: Array<{ range: string; values: string[][] }>
  ): Promise<void> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, count: updates.length }, 'Sheets batchUpdate');

    await this.withRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates.map(u => ({ range: u.range, values: u.values })),
        },
      })
    );
  }

  async clearRange(spreadsheetId: string, range: string): Promise<void> {
    const sheets = await this.getSheets();
    await this.withRetry(() =>
      sheets.spreadsheets.values.clear({ spreadsheetId, range })
    );
  }
}
