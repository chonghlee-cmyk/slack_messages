import { SheetsClient } from './SheetsClient';
import { SlackMessage, ThreadReply } from '../../types/slack';
import { formatDateKST, formatTimeKST } from '../../utils/dateUtils';
import { logger } from '../../utils/logger';

// Is Reply | Channel | Sender | Date | Time | Message | Link | Parent Message | Parent Link | Image URLs | Image Count | Image Sizes (MB)
type SheetRow = [
  string, string, string, string, string, string, string,
  string, string, string, string, string
];

const HEADER: SheetRow = [
  'Is Reply', 'Channel', 'Sender', 'Date', 'Time', 'Message', 'Link',
  'Parent Message', 'Parent Link', 'Image URLs', 'Image Count', 'Image Sizes (MB)',
];

const LINK_COL_INDEX = 6; // G열

export interface SyncLogEntry {
  startedAt: Date;
  finishedAt: Date;
  mode: string;
  newMessages: number;
  newReplies: number;
}

export class SheetsWriter {
  constructor(private readonly client: SheetsClient) {}

  async loadExistingKeys(spreadsheetId: string, tabName: string): Promise<Set<string>> {
    const keys = new Set<string>();
    try {
      const rows = await this.client.getRange(spreadsheetId, `'${tabName}'!A:L`);
      for (const row of rows.slice(1)) {
        const permalink = row[LINK_COL_INDEX] ?? '';
        if (permalink) keys.add(permalink);
      }
      logger.info({ count: keys.size }, 'Loaded existing permalink keys');
    } catch {
      // 탭이 없거나 비어있으면 빈 Set 반환
    }
    return keys;
  }

  async ensureHeader(spreadsheetId: string, tabName: string): Promise<void> {
    await this.client.ensureTabExists(spreadsheetId, tabName);

    const range = `'${tabName}'!A1:L1`;
    const existing = await this.client.getRange(spreadsheetId, range);

    if (existing.length > 0 && existing[0][0] === 'Is Reply') return;

    await this.client.updateRange(spreadsheetId, range, [HEADER]);
    logger.info({ tabName }, 'Header row created');
  }

  async appendRows(
    spreadsheetId: string,
    tabName: string,
    messages: SlackMessage[],
    replies: ThreadReply[]
  ): Promise<number> {
    const rows: SheetRow[] = [
      ...messages.map(m => this.messageToRow(m)),
      ...replies.map(r => this.replyToRow(r)),
    ];

    if (rows.length === 0) return 0;

    // 날짜/시간 오름차순 정렬
    rows.sort((a, b) => `${a[3]} ${a[4]}`.localeCompare(`${b[3]} ${b[4]}`));

    await this.client.appendRows(spreadsheetId, `'${tabName}'`, rows);
    logger.info({ tabName, rowCount: rows.length }, 'Rows appended to sheet');
    return rows.length;
  }

  async ensureLogHeader(spreadsheetId: string, logTabName: string): Promise<void> {
    await this.client.ensureTabExists(spreadsheetId, logTabName);

    const range = `'${logTabName}'!A1:F1`;
    const existing = await this.client.getRange(spreadsheetId, range);
    if (existing.length > 0 && existing[0][0] === '실행일' && existing[0].length >= 6) return;

    await this.client.updateRange(spreadsheetId, range, [[
      '실행일', '실행 시간', '소요 시간', '모드', '신규 메시지', '신규 답글',
    ]]);
  }

  async appendLogRow(spreadsheetId: string, logTabName: string, entry: SyncLogEntry): Promise<void> {
    const durationSec = Math.round((entry.finishedAt.getTime() - entry.startedAt.getTime()) / 1000);
    const durationStr = durationSec >= 60
      ? `${Math.floor(durationSec / 60)}분 ${durationSec % 60}초`
      : `${durationSec}초`;

    const kstDate = new Date(entry.startedAt.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const yyyy = kstDate.getFullYear();
    const mm = String(kstDate.getMonth() + 1).padStart(2, '0');
    const dd = String(kstDate.getDate()).padStart(2, '0');
    const hh = String(kstDate.getHours()).padStart(2, '0');
    const min = String(kstDate.getMinutes()).padStart(2, '0');
    const ss = String(kstDate.getSeconds()).padStart(2, '0');
    const date = `${yyyy}-${mm}-${dd}`;
    const time = `${hh}:${min}:${ss}`;

    await this.client.appendRows(spreadsheetId, `'${logTabName}'`, [[
      date,
      time,
      durationStr,
      entry.mode === 'full' ? '전체' : '증분',
      String(entry.newMessages),
      String(entry.newReplies),
    ]]);
    logger.info({ logTabName }, 'Sync log row appended');
  }

  private jsonOrEmpty(arr: string[]): string {
    return arr.length === 0 ? '' : JSON.stringify(arr);
  }

  private bytesToMB(bytes: number[]): string {
    if (bytes.length === 0) return '';
    const total = bytes.reduce((a, b) => a + b, 0);
    if (total === 0) return '';
    return (total / 1024 / 1024).toFixed(2);
  }

  private messageToRow(msg: SlackMessage): SheetRow {
    return [
      'FALSE',
      msg.slackChannelName || msg.slackChannelId,
      msg.senderName,
      formatDateKST(msg.slackCreatedAt),
      formatTimeKST(msg.slackCreatedAt),
      msg.textClean,
      msg.permalink,
      '', // Parent Message
      '', // Parent Link
      this.jsonOrEmpty(msg.imageUrls),
      msg.imageUrls.length === 0 ? '' : String(msg.imageUrls.length),
      this.bytesToMB(msg.imageBytes),
    ];
  }

  private replyToRow(reply: ThreadReply): SheetRow {
    return [
      'TRUE',
      reply.slackChannelName || reply.slackChannelId,
      reply.senderName,
      formatDateKST(reply.slackCreatedAt),
      formatTimeKST(reply.slackCreatedAt),
      reply.textClean,
      reply.permalink,
      reply.parentText,
      reply.parentPermalink,
      this.jsonOrEmpty(reply.imageUrls),
      reply.imageUrls.length === 0 ? '' : String(reply.imageUrls.length),
      this.bytesToMB(reply.imageBytes),
    ];
  }
}
