import { WebClient, LogLevel } from '@slack/web-api';
import { RateLimiter } from './RateLimiter';
import { SlackSearchResponse, SlackApiMessage } from '../../types/slack';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/sleep';

export interface SearchOptions {
  count: number;
  page: number;
}

export class SlackClient {
  private client: WebClient;
  private rateLimiter: RateLimiter;
  private workspaceDomain: string | null = null;
  private userCache: Map<string, { shortName: string; fullLabel: string }> = new Map();
  private userGroupCache: Map<string, string> | null = null;

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

  async getChannelHistory(channelId: string, oldest?: number, latest?: number): Promise<SlackApiMessage[]> {
    const allMessages: SlackApiMessage[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.rateLimiter.execute(3, () =>
        this.client.conversations.history({
          channel: channelId,
          cursor,
          limit: 200,
          ...(oldest !== undefined ? { oldest: String(oldest) } : {}),
          ...(latest !== undefined ? { latest: String(latest) } : {}),
          inclusive: true,
        })
      );

      const messages = (result.messages as SlackApiMessage[] | undefined) ?? [];
      allMessages.push(...messages);

      cursor = result.response_metadata?.next_cursor || undefined;
      if (cursor) await sleep(300);
    } while (cursor);

    logger.debug({ channelId, count: allMessages.length }, 'Channel history fetched');
    return allMessages;
  }

  async getChannelInfo(channelId: string): Promise<{ id: string; name: string }> {
    const result = await this.rateLimiter.execute(3, () =>
      this.client.conversations.info({ channel: channelId })
    );
    const ch = result.channel as any;
    return { id: channelId, name: ch?.name ?? channelId };
  }

  async getUserGroupName(groupId: string): Promise<string> {
    const map = await this.loadUserGroups();
    return map.get(groupId) ?? 'team';
  }

  private async loadUserGroups(): Promise<Map<string, string>> {
    if (this.userGroupCache) return this.userGroupCache;
    const map = new Map<string, string>();
    try {
      const result = await this.rateLimiter.execute(2, () =>
        this.client.usergroups.list({ include_disabled: true })
      );
      const groups = (result.usergroups as any[] | undefined) ?? [];
      for (const g of groups) {
        const id: string = g.id;
        const name: string = g.name || g.handle || id;
        if (id) map.set(id, name);
      }
      logger.debug({ count: map.size }, 'User groups cached');
    } catch (err: any) {
      logger.warn(
        { error: err?.data?.error ?? err?.message },
        'usergroups.list failed — check usergroups:read scope. Falling back to "team".'
      );
    }
    this.userGroupCache = map;
    return map;
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
