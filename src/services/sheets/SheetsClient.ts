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

  async getRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, range }, 'Sheets getRange');

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return (response.data.values as string[][] | null | undefined) ?? [];
  }

  async appendRows(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<void> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, range, rowCount: values.length }, 'Sheets appendRows');

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }

  async updateRange(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<void> {
    const sheets = await this.getSheets();
    logger.debug({ spreadsheetId, range, rowCount: values.length }, 'Sheets updateRange');

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async clearRange(spreadsheetId: string, range: string): Promise<void> {
    const sheets = await this.getSheets();
    await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  }
}
