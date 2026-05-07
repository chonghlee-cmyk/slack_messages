import * as fs from 'fs';
import * as path from 'path';
import { SlackClient } from '../services/slack/SlackClient';
import { SlackCollector } from '../services/slack/SlackCollector';
import { MessageNormalizer } from '../services/slack/MessageNormalizer';
import { SheetsClient } from '../services/sheets/SheetsClient';
import { SheetsReader } from '../services/sheets/SheetsReader';
import { SheetsWriter, SyncLogEntry } from '../services/sheets/SheetsWriter';
import { SyncStateFile, SyncJobOptions } from '../types/sync';
import { logger } from '../utils/logger';
import { subtractDays } from '../utils/dateUtils';

const STATE_FILE = path.resolve(process.cwd(), 'data', 'sync-state.json');

export interface EngineConfig {
  slackToken: string;
  spreadsheetId: string;
  artworkTab: string;
  outputTab: string;
  logTab?: string;
  artworkNameColumn: number;
  channelIds: string[];
  excludedUserIds: string[];
  pageSize: number;
  concurrency: number;
}

export class SyncEngine {
  private slackClient: SlackClient;
  private sheetsClient: SheetsClient;
  private sheetsReader: SheetsReader;
  private sheetsWriter: SheetsWriter;
  private stateLock = false;
  private stateLockQueue: Array<() => void> = [];

  constructor(private readonly config: EngineConfig) {
    this.slackClient = new SlackClient(config.slackToken);
    this.sheetsClient = new SheetsClient();
    this.sheetsReader = new SheetsReader(this.sheetsClient);
    this.sheetsWriter = new SheetsWriter(this.sheetsClient);
  }

  async run(options: SyncJobOptions): Promise<void> {
    const jobRunId = `run_${Date.now()}`;
    const mode = options.forceFullSync ? 'full' : 'incremental';
    const startedAt = new Date();
    logger.info({ jobRunId, mode, concurrency: this.config.concurrency }, 'Sync started');

    const domain = await this.slackClient.getWorkspaceDomain();
    const normalizer = new MessageNormalizer(
      domain,
      new Set(this.config.excludedUserIds),
      this.slackClient
    );
    const collector = new SlackCollector(this.slackClient, normalizer);

    await this.sheetsWriter.ensureHeader(this.config.spreadsheetId, this.config.outputTab);

    const artworks = await this.sheetsReader.readArtworks(
      this.config.spreadsheetId,
      this.config.artworkTab,
      this.config.artworkNameColumn
    );

    const toProcess = options.artworkFilter?.length
      ? artworks.filter(a => options.artworkFilter!.includes(a.name))
      : artworks;

    logger.info({ total: toProcess.length, mode }, 'Starting artwork sync');

    if (this.config.logTab) {
      await this.sheetsWriter.ensureLogHeader(this.config.spreadsheetId, this.config.logTab);
    }

    const syncState = this.loadSyncState();
    let successCount = 0;
    let failCount = 0;
    let totalMessages = 0;
    let totalReplies = 0;
    const newArtworks: string[] = [];

    // 동시 처리 큐
    const queue = [...toProcess.entries()];
    const total = toProcess.length;

    const worker = async () => {
      while (true) {
        const next = queue.shift();
        if (!next) break;
        const [i, artwork] = next;
        const artworkState = syncState[artwork.name];

        let afterDate: Date | undefined;
        if (!options.forceFullSync && artworkState?.lastSyncedAt) {
          afterDate = new Date(artworkState.lastSyncedAt);
        } else if (!options.forceFullSync) {
          afterDate = subtractDays(new Date(), options.initialLookbackDays);
        }

        logger.info({ artwork: artwork.name, progress: `${i + 1}/${total}` }, 'Syncing artwork');

        try {
          const result = await collector.collectForArtwork(artwork.name, {
            channelIds: this.config.channelIds,
            pageSize: this.config.pageSize,
            afterDate,
          });

          if (result.messages.length > 0 || result.replies.length > 0) {
            await this.sheetsWriter.appendRows(
              this.config.spreadsheetId,
              this.config.outputTab,
              options.dryRun ? [] : result.messages,
              options.dryRun ? [] : result.replies
            );
            totalMessages += result.messages.length;
            totalReplies += result.replies.length;
            newArtworks.push(artwork.name);
            logger.info(
              { artwork: artwork.name, messages: result.messages.length, replies: result.replies.length },
              'Artwork sync done'
            );
          } else {
            logger.debug({ artwork: artwork.name }, 'No new messages');
          }

          syncState[artwork.name] = {
            lastSyncedAt: new Date().toISOString(),
            status: 'completed',
            totalMessages: (artworkState?.totalMessages ?? 0) + result.messages.length,
            totalReplies: (artworkState?.totalReplies ?? 0) + result.replies.length,
          };
          await this.saveSyncStateLocked(syncState);
          successCount++;
        } catch (err: any) {
          logger.error({ artwork: artwork.name, error: err.message }, 'Artwork sync failed');
          syncState[artwork.name] = {
            ...(artworkState ?? { totalMessages: 0, totalReplies: 0 }),
            status: 'failed',
            errorMessage: err.message,
          };
          await this.saveSyncStateLocked(syncState);
          failCount++;
        }
      }
    };

    await Promise.all(Array.from({ length: this.config.concurrency }, () => worker()));

    const finishedAt = new Date();

    if (this.config.logTab) {
      const logEntry: SyncLogEntry = { startedAt, finishedAt, mode };
      await this.sheetsWriter.appendLogRow(this.config.spreadsheetId, this.config.logTab, logEntry);
    }

    logger.info(
      { jobRunId, successCount, failCount, totalMessages, totalReplies },
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

  private async saveSyncStateLocked(state: SyncStateFile): Promise<void> {
    await new Promise<void>(resolve => {
      if (!this.stateLock) {
        this.stateLock = true;
        resolve();
      } else {
        this.stateLockQueue.push(resolve);
      }
    });
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to save sync state');
    } finally {
      const next = this.stateLockQueue.shift();
      if (next) next();
      else this.stateLock = false;
    }
  }
}
