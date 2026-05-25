import * as fs from 'fs';
import * as path from 'path';
import { SlackClient } from '../services/slack/SlackClient';
import { SlackCollector } from '../services/slack/SlackCollector';
import { MessageNormalizer } from '../services/slack/MessageNormalizer';
import { SheetsClient } from '../services/sheets/SheetsClient';
import { SheetsWriter, SyncLogEntry } from '../services/sheets/SheetsWriter';
import { logger } from '../utils/logger';
import { subtractDays } from '../utils/dateUtils';

const STATE_FILE = path.resolve(process.cwd(), 'data', 'sync-state.json');

export interface EngineConfig {
  slackToken: string;
  spreadsheetId: string;
  channelId: string;
  outputTab: string;
  logTab?: string;
  excludedUserIds: string[];
  /** 첫 실행 시 과거 몇 일치를 가져올지 (default: 90) */
  initialLookbackDays: number;
}

interface ChannelSyncState {
  lastSyncedAt?: string;
  totalMessages: number;
  totalReplies: number;
}

type SyncStateFile = Record<string, ChannelSyncState>;

export interface SyncJobOptions {
  /** true 이면 afterDate 없이 전체 수집 */
  forceFullSync?: boolean;
  /** 실제로 시트에 쓰지 않고 로그만 */
  dryRun?: boolean;
}

export class SyncEngine {
  private slackClient: SlackClient;
  private sheetsClient: SheetsClient;
  private sheetsWriter: SheetsWriter;

  constructor(private readonly config: EngineConfig) {
    this.slackClient = new SlackClient(config.slackToken);
    this.sheetsClient = new SheetsClient();
    this.sheetsWriter = new SheetsWriter(this.sheetsClient);
  }

  async run(options: SyncJobOptions = {}): Promise<void> {
    const mode = options.forceFullSync ? 'full' : 'incremental';
    const startedAt = new Date();
    const { channelId, spreadsheetId, outputTab } = this.config;

    logger.info({ channelId, mode }, 'Sync started');

    const domain = await this.slackClient.getWorkspaceDomain();
    const normalizer = new MessageNormalizer(
      domain,
      new Set(this.config.excludedUserIds),
      this.slackClient
    );
    const collector = new SlackCollector(this.slackClient, normalizer);

    // 헤더 & 기존 키 로드
    await this.sheetsWriter.ensureHeader(spreadsheetId, outputTab);
    const existingKeys = await this.sheetsWriter.loadExistingKeys(spreadsheetId, outputTab);

    // 증분 범위 계산
    // - 전체 재수집: afterDate 없음
    // - 증분: 오늘 기준 어제부터 (D-1) — 오늘 sync 시 어제+오늘 모두 커버
    // - 첫 실행(state 없음): initialLookbackDays 일 전부터
    let afterDate: Date | undefined;

    if (!options.forceFullSync) {
      const state = this.loadSyncState();
      const channelState = state[channelId];

      if (channelState?.lastSyncedAt) {
        // 매일 실행: 어제(D-1)부터 수집해 누락 방지
        afterDate = subtractDays(new Date(), 1);
        logger.info({ afterDate: afterDate.toISOString() }, 'Incremental sync: collecting from yesterday');
      } else {
        // 첫 실행: 0이면 전체 히스토리, 아니면 지정된 일수만큼
        if (this.config.initialLookbackDays > 0) {
          afterDate = subtractDays(new Date(), this.config.initialLookbackDays);
          logger.info(
            { afterDate: afterDate.toISOString(), days: this.config.initialLookbackDays },
            'First run: collecting initial lookback'
          );
        } else {
          afterDate = undefined;
          logger.info('First run: collecting full channel history (no date limit)');
        }
      }
    }

    // 수집
    const result = await collector.collectChannel(channelId, { afterDate });

    // dedup: permalink 기준
    const newMessages = result.messages.filter(m => {
      if (existingKeys.has(m.permalink)) return false;
      existingKeys.add(m.permalink);
      return true;
    });
    const newReplies = result.replies.filter(r => {
      if (existingKeys.has(r.permalink)) return false;
      existingKeys.add(r.permalink);
      return true;
    });

    logger.info(
      { new: newMessages.length + newReplies.length, total: result.totalFound },
      'Dedup complete'
    );

    // 시트에 쓰기
    if (!options.dryRun && (newMessages.length > 0 || newReplies.length > 0)) {
      await this.sheetsWriter.appendRows(spreadsheetId, outputTab, newMessages, newReplies);
    } else if (options.dryRun) {
      logger.info('Dry run — skipping sheet write');
    } else {
      logger.info('No new messages to write');
    }

    // sync state 저장
    const state = this.loadSyncState();
    state[channelId] = {
      lastSyncedAt: new Date().toISOString(),
      totalMessages: (state[channelId]?.totalMessages ?? 0) + newMessages.length,
      totalReplies: (state[channelId]?.totalReplies ?? 0) + newReplies.length,
    };
    this.saveSyncState(state);

    const finishedAt = new Date();

    if (this.config.logTab) {
      await this.sheetsWriter.ensureLogHeader(spreadsheetId, this.config.logTab);
      const logEntry: SyncLogEntry = {
        startedAt,
        finishedAt,
        mode,
        newMessages: newMessages.length,
        newReplies: newReplies.length,
      };
      await this.sheetsWriter.appendLogRow(spreadsheetId, this.config.logTab, logEntry);
    }

    logger.info(
      { newMessages: newMessages.length, newReplies: newReplies.length },
      'Sync completed'
    );
  }

  private loadSyncState(): SyncStateFile {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to load sync state, starting fresh');
    }
    return {};
  }

  private saveSyncState(state: SyncStateFile): void {
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to save sync state');
    }
  }
}
