import { SlackClient } from './SlackClient';
import { MessageNormalizer } from './MessageNormalizer';
import { SlackMessage, ThreadReply } from '../../types/slack';
import { logger } from '../../utils/logger';

export interface CollectChannelOptions {
  /**
   * 이 시각 이후에 새 답글이 있는(=latest_reply가 이후인) 스레드만 답글을 재수집한다.
   * undefined면 모든 스레드의 답글을 수집한다 (전체 재수집 / 첫 실행).
   *
   * 부모 메시지 나열(conversations.history)은 항상 전체를 훑으므로,
   * 오래된 스레드에 뒤늦게 달린 답글도 latest_reply로 감지되어 누락되지 않는다.
   * 비싼 conversations.replies 호출만 이 임계로 게이팅해 속도를 유지한다.
   */
  replyThreshold?: Date;
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
    const thresholdMs = options.replyThreshold?.getTime();

    logger.info(
      { channelId, replyThreshold: options.replyThreshold?.toISOString() ?? 'all' },
      'Fetching channel history (full enumeration)'
    );

    // 채널 정보 (이름) 가져오기
    const channelInfo = await this.slackClient.getChannelInfo(channelId);
    const channelName = channelInfo.name;

    // 부모 메시지는 항상 전체를 훑는다 (oldest 없음).
    // 오래된 스레드에 새 답글이 달려도 그 부모가 여기 나와야 latest_reply로 감지할 수 있다.
    const rawMessages = await this.slackClient.getChannelHistory(channelId);

    const allMessages: SlackMessage[] = [];
    const allReplies: ThreadReply[] = [];
    let threadsScanned = 0;
    let threadsSkipped = 0;

    for (const raw of rawMessages) {
      // 스레드 루트가 아닌 답글 메시지는 history에 포함될 수 있으므로 스킵
      // (thread_ts가 있고 ts !== thread_ts 이면 답글)
      if (raw.thread_ts && raw.ts !== raw.thread_ts) continue;

      const msg = await this.normalizer.normalize(raw, channelId, channelName);
      if (msg) allMessages.push(msg);

      const replyCount = raw.reply_count ?? 0;
      const threadTs = raw.thread_ts ?? raw.ts;
      if (replyCount === 0 || !threadTs) continue;

      // 답글 재수집 여부 결정 (비싼 conversations.replies 게이팅)
      // - 임계 없음: 항상 수집
      // - 임계 있음: latest_reply가 임계 이후인 스레드만 (latest_reply 없으면 안전하게 수집)
      let scan = true;
      if (thresholdMs !== undefined) {
        const latestReplyMs = raw.latest_reply ? Number(raw.latest_reply) * 1000 : NaN;
        scan = Number.isNaN(latestReplyMs) || latestReplyMs >= thresholdMs;
      }
      if (!scan) {
        threadsSkipped++;
        continue;
      }
      threadsScanned++;

      // 스레드 답글 수집 (부모가 봇/빈 메시지여도 답글은 가져옴)
      // parent 정보: 부모가 정상이면 msg에서, 봇/빈이면 raw에서 fallback
      const parentText = msg?.textClean ?? (raw.text ?? '[봇/시스템 메시지]');
      const parentPermalink = msg?.permalink ?? raw.permalink ?? '';

      const rawReplies = await this.slackClient.getThreadReplies(channelId, threadTs);
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

    logger.info(
      { channelId, messages: allMessages.length, replies: allReplies.length, threadsScanned, threadsSkipped },
      'Channel collection complete'
    );

    return {
      messages: allMessages,
      replies: allReplies,
      totalFound: rawMessages.length,
    };
  }
}
