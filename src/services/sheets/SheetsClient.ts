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
      credentials = JSON.parse(json);
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
        valueInputOption: 'USER_ENTERED',
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

  async clearRange(spreadsheetId: string, range: string): Promise<void> {
    const sheets = await this.getSheets();
    await this.withRetry(() =>
      sheets.spreadsheets.values.clear({ spreadsheetId, range })
    );
  }
}
