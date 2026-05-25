import { SlackClient } from './SlackClient';
import { MessageNormalizer } from './MessageNormalizer';
import { SlackMessage, ThreadReply } from '../../types/slack';
import { logger } from '../../utils/logger';

export interface CollectChannelOptions {
  afterDate?: Date;
}

export interface CollectResult {
  messages: SlackMessage[];
  replies: ThreadReply[];
  totalFound: number;
}

export class SlackCollector {
  constructor(
    private readonly slackClient: SlackClient,
    private readonly normalizer: MessageNormalizer
  ) {}

  async collectChannel(
    channelId: string,
    options: CollectChannelOptions = {}
  ): Promise<CollectResult> {
    // afterDate → Slack oldest 파라미터 (Unix timestamp 초 단위)
    const oldest = options.afterDate
      ? options.afterDate.getTime() / 1000
      : undefined;

    logger.info(
      { channelId, after: options.afterDate?.toISOString() ?? 'all' },
      'Fetching channel history'
    );

    // 채널 정보 (이름) 가져오기
    const channelInfo = await this.slackClient.getChannelInfo(channelId);
    const channelName = channelInfo.name;

    const rawMessages = await this.slackClient.getChannelHistory(channelId, oldest);

    const allMessages: SlackMessage[] = [];
    const allReplies: ThreadReply[] = [];

    for (const raw of rawMessages) {
      // 스레드 루트가 아닌 답글 메시지는 history에 포함될 수 있으므로 스킵
      // (thread_ts가 있고 ts !== thread_ts 이면 답글)
      if (raw.thread_ts && raw.ts !== raw.thread_ts) continue;

      const msg = await this.normalizer.normalize(raw, channelId, channelName);
      if (msg) allMessages.push(msg);

      // 스레드 답글 수집 (부모가 봇/빈 메시지여도 답글은 가져옴)
      const replyCount = raw.reply_count ?? 0;
      const threadTs = raw.thread_ts ?? raw.ts;
      if (replyCount > 0 && threadTs) {
        // parent 정보: 부모가 정상이면 msg에서, 봇/빈이면 raw에서 fallback
        const parentText = msg?.textClean ?? (raw.text ?? '[봇/시스템 메시지]');
        const parentPermalink = msg?.permalink ?? raw.permalink ?? '';

        const rawReplies = await this.slackClient.getThreadReplies(
          channelId,
          threadTs
        );
        for (const rawReply of rawReplies) {
          const reply = await this.normalizer.normalizeReply(
            rawReply,
            channelId,
            channelName,
            parentText,
            parentPermalink
          );
          if (reply) allReplies.push(reply);
        }
      }
    }

    logger.info(
      { channelId, messages: allMessages.length, replies: allReplies.length },
      'Channel collection complete'
    );

    return {
      messages: allMessages,
      replies: allReplies,
      totalFound: rawMessages.length,
    };
  }
}
