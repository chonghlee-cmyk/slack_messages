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

/** 증분 실행 시 마지막 동기화 시각에서 이만큼 더 과거부터 스레드를 재스캔 (안전 버퍼) */
const REPLY_RESCAN_BUFFER_DAYS = 2;

export interface EngineConfig {
  slackToken: string;
  spreadsheetId: string;
  channelId: string;
  outputTab: string;
  logTab?: string;
  excludedUserIds: string[];
  /** 첫 실행 시 과거 몇 일치의 스레드 답글을 가져올지 (0=전체, default: 0) */
  initialLookbackDays: number;
}

interface ChannelSyncState {
  lastSyncedAt?: string;
  totalMessages: number;
  totalReplies: number;
}

type SyncStateFile = Record<string, ChannelSyncState>;

export interface SyncJobOptions {
  /** true 이면 모든 스레드의 답글을 재수집 (latest_reply 게이팅 없이 전체) */
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

    // 답글 재수집 임계 시각 계산
    // 부모 메시지 나열은 항상 전체이므로, 여기서는 "어떤 스레드의 답글을
    // 다시 긁을지"만 정한다 (latest_reply 기반 게이팅).
    // - 전체 재수집(forceFullSync): 임계 없음 → 모든 스레드 답글 수집
    // - 증분: 마지막 성공 동기화 시각 − 버퍼(2일). 그 이후 활동한 스레드만 재수집.
    //   (부분 실패/시계 오차 대비 버퍼. 중복은 permalink dedup이 흡수)
    // - 첫 실행: initialLookbackDays>0이면 그 기간, 0이면 전체
    let replyThreshold: Date | undefined;

    if (!options.forceFullSync) {
      const state = this.loadSyncState();
      const channelState = state[channelId];

      if (channelState?.lastSyncedAt) {
        replyThreshold = subtractDays(new Date(channelState.lastSyncedAt), REPLY_RESCAN_BUFFER_DAYS);
        logger.info(
          { replyThreshold: replyThreshold.toISOString() },
          'Incremental sync: rescanning threads active since last sync'
        );
      } else if (this.config.initialLookbackDays > 0) {
        replyThreshold = subtractDays(new Date(), this.config.initialLookbackDays);
        logger.info(
          { replyThreshold: replyThreshold.toISOString(), days: this.config.initialLookbackDays },
          'First run: collecting replies within initial lookback'
        );
      } else {
        logger.info('First run: collecting all thread replies (no limit)');
      }
    }

    // 수집
    const result = await collector.collectChannel(channelId, { replyThreshold });

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
