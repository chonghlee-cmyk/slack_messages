import { SheetsClient } from './SheetsClient';
import { ArtworkRaw } from '../../types/artwork';
import { logger } from '../../utils/logger';

export class SheetsReader {
  constructor(private readonly client: SheetsClient) {}

  async readArtworks(
    spreadsheetId: string,
    tabName: string,
    nameColumnIndex: number = 0
  ): Promise<ArtworkRaw[]> {
    logger.info({ spreadsheetId, tabName }, 'Reading artwork list');

    // 탭 전체를 읽음 (헤더 포함)
    const range = `'${tabName}'`;
    const rows = await this.client.getRange(spreadsheetId, range);

    if (rows.length === 0) {
      logger.warn({ tabName }, 'Sheet is empty');
      return [];
    }

    // 첫 번째 행은 헤더로 간주하고 스킵
    const dataRows = rows.slice(1);
    const artworks: ArtworkRaw[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sheetRowIndex = i + 2; // 1-based + 헤더 행

      const rawName = row[nameColumnIndex];
      if (!rawName) continue;

      const name = rawName.toString().trim();
      if (!name) continue;

      artworks.push({ name, sheetRowIndex });
    }

    // 이름 기준 중복 제거 (normalizedName으로 비교)
    const seen = new Set<string>();
    const unique = artworks.filter(({ name }) => {
      const key = normalizeName(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(
      { total: artworks.length, unique: unique.length, tabName },
      'Artwork list loaded'
    );

    return unique;
  }
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    // 전각 스페이스 → 일반 스페이스
    .replace(/　/g, ' ')
    // 여러 공백 → 단일 공백
    .replace(/\s+/g, ' ');
}
