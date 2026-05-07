import { WebClient, LogLevel } from '@slack/web-api';
import { RateLimiter } from './RateLimiter';
import { SlackSearchResponse, SlackApiMessage } from '../../types/slack';
import { logger } from '../../utils/logger';

export interface SearchOptions {
  count: number;
  page: number;
}

export class SlackClient {
  private client: WebClient;
  private rateLimiter: RateLimiter;
  private workspaceDomain: string | null = null;
  private userCache: Map<string, { shortName: string; fullLabel: string }> = new Map();

  constructor(token: string) {
    this.client = new WebClient(token, { logLevel: LogLevel.ERROR });
    this.rateLimiter = new RateLimiter();
  }

  async getWorkspaceDomain(): Promise<string> {
    if (this.workspaceDomain) return this.workspaceDomain;

    const result = await this.rateLimiter.execute(4, () => this.client.auth.test());
    // url 형태: "https://myworkspace.slack.com/"
    const url = (result.url as string) ?? '';
    this.workspaceDomain = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    logger.debug({ domain: this.workspaceDomain }, 'Workspace domain cached');
    return this.workspaceDomain;
  }

  async searchMessages(query: string, options: SearchOptions): Promise<SlackSearchResponse> {
    return this.rateLimiter.execute(2, async () => {
      const result = await this.client.search.messages({
        query,
        count: options.count,
        page: options.page,
        sort: 'timestamp',
        sort_dir: 'asc',
      } as any);
      return result as unknown as SlackSearchResponse;
    });
  }

  async getThreadReplies(channelId: string, threadTs: string): Promise<SlackApiMessage[]> {
    const replies: SlackApiMessage[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.rateLimiter.execute(3, () =>
        this.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          cursor,
          limit: 200,
        })
      );

      const messages = (result.messages as SlackApiMessage[] | undefined) ?? [];
      // 첫 번째 메시지는 부모 메시지 — 스킵
      replies.push(...messages.slice(1));

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return replies;
  }

  async getUserDisplayName(userId: string): Promise<string> {
    return (await this.getUserInfo(userId)).shortName;
  }

  private async getUserInfo(userId: string): Promise<{ shortName: string; fullLabel: string }> {
    if (this.userCache.has(userId)) return this.userCache.get(userId)!;

    try {
      const result = await this.rateLimiter.execute(4, () =>
        this.client.users.info({ user: userId })
      );
      const user = result.user as any;
      const rawName: string =
        user?.profile?.display_name ||
        user?.profile?.real_name ||
        user?.real_name ||
        user?.name ||
        userId;
      const shortName = rawName.split('/')[0].trim();
      const entry = { shortName, fullLabel: shortName };
      this.userCache.set(userId, entry);
      return entry;
    } catch (err: any) {
      logger.warn({ userId, error: err?.data?.error ?? err?.message }, 'users.info failed — check users:read scope');
      const entry = { shortName: userId, fullLabel: userId };
      this.userCache.set(userId, entry);
      return entry;
    }
  }
}
