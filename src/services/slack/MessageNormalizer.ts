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

  async normalize(
    raw: SlackApiMessage,
    channelId: string,
    channelName: string
  ): Promise<SlackMessage | null> {
    if (!raw.ts) return null;
    if (this.isBot(raw)) return null;

    const text = raw.text ?? '';

    const [userMap, subteamMap, senderName] = await Promise.all([
      this.resolveUserMentions(text),
      this.resolveSubteamMentions(text),
      raw.user
        ? this.slackClient.getUserDisplayName(raw.user)
        : Promise.resolve(raw.username ?? 'unknown'),
    ]);

    const textClean = cleanMessageText(text, userMap, subteamMap);

    const { imageUrls, imageNames, imageBytes } = this.extractImages(raw);

    // 텍스트도 없고 이미지도 없으면 스킵
    if (!textClean && imageUrls.length === 0) return null;

    return {
      slackTs: raw.ts,
      slackChannelId: channelId,
      slackChannelName: channelName,
      slackUserId: raw.user,
      text,
      textClean,
      permalink: raw.permalink ?? this.buildPermalink(channelId, raw.ts),
      isReply: false,
      senderName,
      isBot: false,
      threadTs: raw.thread_ts,
      replyCount: raw.reply_count ?? 0,
      slackCreatedAt: slackTsToDate(raw.ts),
      imageUrls,
      imageNames,
      imageBytes,
    };
  }

  async normalizeReply(
    raw: SlackApiMessage,
    channelId: string,
    channelName: string,
    parentText: string,
    parentPermalink: string
  ): Promise<ThreadReply | null> {
    if (!raw.ts) return null;
    if (this.isBot(raw)) return null;

    const text = raw.text ?? '';
    const threadTs = raw.thread_ts ?? '';

    const [userMap, subteamMap, senderName] = await Promise.all([
      this.resolveUserMentions(text),
      this.resolveSubteamMentions(text),
      raw.user
        ? this.slackClient.getUserDisplayName(raw.user)
        : Promise.resolve(raw.username ?? 'unknown'),
    ]);

    const textClean = cleanMessageText(text, userMap, subteamMap);
    const { imageUrls, imageNames, imageBytes } = this.extractImages(raw);

    if (!textClean && imageUrls.length === 0) return null;

    const parentSnippet = parentText.length > 80
      ? parentText.slice(0, 80) + '…'
      : parentText;

    return {
      parentMessageTs: threadTs,
      slackThreadTs: threadTs,
      slackTs: raw.ts,
      slackChannelId: channelId,
      slackChannelName: channelName,
      text,
      textClean,
      permalink: this.buildReplyPermalink(channelId, raw.ts, threadTs),
      isReply: true,
      senderName,
      isBot: false,
      slackCreatedAt: slackTsToDate(raw.ts),
      imageUrls,
      imageNames,
      imageBytes,
      parentText: parentSnippet,
      parentPermalink,
    };
  }

  private extractImages(raw: SlackApiMessage): {
    imageUrls: string[];
    imageNames: string[];
    imageBytes: number[];
  } {
    const imageUrls: string[] = [];
    const imageNames: string[] = [];
    const imageBytes: number[] = [];

    for (const file of raw.files ?? []) {
      if (file.mimetype?.startsWith('image/')) {
        const url = file.url_private ?? file.permalink ?? '';
        if (url) {
          imageUrls.push(url);
          imageNames.push(file.name ?? '');
          imageBytes.push(file.size ?? 0);
        }
      }
    }

    return { imageUrls, imageNames, imageBytes };
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

  private async resolveSubteamMentions(text: string): Promise<Map<string, string>> {
    const matches = [...text.matchAll(/<!subteam\^([A-Z0-9]+)(?:\|[^>]+)?>/g)];
    const uniqueIds = [...new Set(matches.map(m => m[1]))];
    const map = new Map<string, string>();
    await Promise.all(
      uniqueIds.map(async id => {
        const name = await this.slackClient.getUserGroupName(id);
        map.set(id, name);
      })
    );
    return map;
  }

  private isBot(raw: SlackApiMessage): boolean {
    if (raw.bot_id) return true;
    if (raw.subtype === 'bot_message') return true;
    if (!raw.user && raw.username) return true;
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
