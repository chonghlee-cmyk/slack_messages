import { SheetsClient } from './SheetsClient';
import { SlackMessage, ThreadReply } from '../../types/slack';
import { formatDateKST, formatTimeKST } from '../../utils/dateUtils';
import { logger } from '../../utils/logger';

type SheetRow = [string, string, string, string, string, string, string];

export interface SyncLogEntry {
  startedAt: Date;
  finishedAt: Date;
  mode: string;
}

export class SheetsWriter {
  constructor(private readonly client: SheetsClient) {}

  async ensureHeader(spreadsheetId: string, tabName: string): Promise<void> {
    const range = `'${tabName}'!A1:G1`;
    const existing = await this.client.getRange(spreadsheetId, range);

    if (existing.length > 0 && existing[0][0] === 'Title Name') return;

    const header: SheetRow = [
      'Title Name', 'Channel Name', 'Sender', 'Date', 'Time', 'Message Content', 'Message Link',
    ];
    await this.client.updateRange(spreadsheetId, range, [header]);
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
    const range = `'${logTabName}'!A1:D1`;
    const existing = await this.client.getRange(spreadsheetId, range);
    if (existing.length > 0 && existing[0][0] === '실행일') return;

    await this.client.updateRange(spreadsheetId, range, [['실행일', '실행 시간', '소요 시간', '모드']]);
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
    const date = `${yyyy}-${dd}-${mm}`;
    const time = `${hh}:${min}:${ss}`;

    await this.client.appendRows(spreadsheetId, `'${logTabName}'`, [[
      date,
      time,
      durationStr,
      entry.mode === 'full' ? '전체' : '증분',
    ]]);
    logger.info({ logTabName }, 'Sync log row appended');
  }

  private messageToRow(msg: SlackMessage): SheetRow {
    return [
      msg.artworkName,
      msg.slackChannelName || msg.slackChannelId,
      msg.senderName,
      formatDateKST(msg.slackCreatedAt),
      formatTimeKST(msg.slackCreatedAt),
      msg.textClean,
      msg.permalink,
    ];
  }

  private replyToRow(reply: ThreadReply): SheetRow {
    return [
      reply.artworkName,
      reply.slackChannelName || reply.slackChannelId,
      reply.senderName,
      formatDateKST(reply.slackCreatedAt),
      formatTimeKST(reply.slackCreatedAt),
      reply.textClean,
      reply.permalink,
    ];
  }
}
