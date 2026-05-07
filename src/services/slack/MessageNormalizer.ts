import { SlackApiMessage, SlackMessage, ThreadReply } from '../../types/slack';
import { cleanMessageText } from '../../utils/textUtils';
import { slackTsToDate } from '../../utils/dateUtils';
import { SlackClient } from './SlackClient';

export class MessageNormalizer {
  constructor(
    private readonly workspaceDomain: string,
    private readonly excludedUserIds: Set<string>,
    private readonly slackClient: SlackClient
  ) {}

  async normalize(raw: SlackApiMessage, artworkName: string): Promise<SlackMessage | null> {
    if (!raw.ts) return null;
    if (this.isBot(raw)) return null;

    const channelId = raw.channel?.id ?? '';
    const channelName = raw.channel?.name ?? '';
    const text = raw.text ?? '';

    const [userMap, senderName] = await Promise.all([
      this.resolveUserMentions(text),
      raw.user ? this.slackClient.getUserDisplayName(raw.user) : Promise.resolve(raw.username ?? 'unknown'),
    ]);

    const textClean = cleanMessageText(text, userMap);
    if (!textClean) return null;

    return {
      slackTs: raw.ts,
      slackChannelId: channelId,
      slackChannelName: channelName,
      slackUserId: raw.user,
      text,
      textClean,
      permalink: raw.permalink ?? this.buildPermalink(channelId, raw.ts),
      artworkName,
      senderName,
      isBot: false,
      threadTs: raw.thread_ts,
      replyCount: raw.reply_count ?? 0,
      slackCreatedAt: slackTsToDate(raw.ts),
    };
  }

  async normalizeReply(
    raw: SlackApiMessage,
    channelId: string,
    channelName: string,
    artworkName: string
  ): Promise<ThreadReply | null> {
    if (!raw.ts) return null;
    if (this.isBot(raw)) return null;

    const text = raw.text ?? '';
    const threadTs = raw.thread_ts ?? '';

    const [userMap, senderName] = await Promise.all([
      this.resolveUserMentions(text),
      raw.user ? this.slackClient.getUserDisplayName(raw.user) : Promise.resolve(raw.username ?? 'unknown'),
    ]);

    const textClean = cleanMessageText(text, userMap);
    if (!textClean) return null;

    return {
      parentMessageTs: threadTs,
      slackThreadTs: threadTs,
      slackTs: raw.ts,
      slackChannelId: channelId,
      slackChannelName: channelName,
      text,
      textClean,
      permalink: this.buildReplyPermalink(channelId, raw.ts, threadTs),
      senderName,
      isBot: false,
      slackCreatedAt: slackTsToDate(raw.ts),
      artworkName,
    };
  }

  private async resolveUserMentions(text: string): Promise<Map<string, string>> {
    const matches = [...text.matchAll(/<@([A-Z0-9]+)>/g)];
    const uniqueIds = [...new Set(matches.map(m => m[1]))];
    const map = new Map<string, string>();
    await Promise.all(
      uniqueIds.map(async id => {
        const name = await this.slackClient.getUserDisplayName(id);
        map.set(id, name);
      })
    );
    return map;
  }

  private isBot(raw: SlackApiMessage): boolean {
    if (raw.bot_id) return true;
    if (raw.subtype === 'bot_message') return true;
    if (!raw.user && raw.username) return true;  // 유저 ID 없이 username만 있으면 봇/webhook
    if (raw.user && this.excludedUserIds.has(raw.user)) return true;
    return false;
  }

  private buildPermalink(channelId: string, ts: string): string {
    const tsFormatted = ts.replace('.', '');
    return `https://${this.workspaceDomain}/archives/${channelId}/p${tsFormatted}`;
  }

  private buildReplyPermalink(channelId: string, ts: string, threadTs: string): string {
    const tsFormatted = ts.replace('.', '');
    return `https://${this.workspaceDomain}/archives/${channelId}/p${tsFormatted}?thread_ts=${threadTs}&cid=${channelId}`;
  }
}
