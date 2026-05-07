import { SlackClient } from './SlackClient';
import { MessageNormalizer } from './MessageNormalizer';
import { SlackMessage, ThreadReply } from '../../types/slack';
import { dateToSlackSearchDate } from '../../utils/dateUtils';
import { sleep } from '../../utils/sleep';
import { logger } from '../../utils/logger';

export interface CollectOptions {
  channelIds: string[];
  pageSize: number;
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

  async collectForArtwork(
    artworkName: string,
    options: CollectOptions
  ): Promise<CollectResult> {
    const query = this.buildQuery(artworkName, options.channelIds, options.afterDate);
    logger.debug({ artworkName, query }, 'Searching Slack');

    const allMessages: SlackMessage[] = [];
    const allReplies: ThreadReply[] = [];
    let page = 1;
    let totalPages = 1;
    let totalFound = 0;

    do {
      const result = await this.slackClient.searchMessages(query, {
        count: options.pageSize,
        page,
      });

      if (!result?.messages) break;

      const { matches, paging } = result.messages;
      totalPages = paging?.pages ?? 1;
      totalFound = paging?.total ?? 0;

      if (matches.length > 0) {
        logger.debug(
          { artworkName, page, totalPages, matches: matches.length },
          'Search page fetched'
        );
      }

      for (const raw of matches) {
        const msg = await this.normalizer.normalize(raw, artworkName);
        if (!msg) continue;
        allMessages.push(msg);

        // 스레드 답글 수집
        if (msg.replyCount > 0 && msg.threadTs) {
          const rawReplies = await this.slackClient.getThreadReplies(
            msg.slackChannelId,
            msg.threadTs
          );
          for (const rawReply of rawReplies) {
            const reply = await this.normalizer.normalizeReply(
              rawReply,
              msg.slackChannelId,
              msg.slackChannelName,
              artworkName
            );
            if (reply) allReplies.push(reply);
          }
        }
      }

      page++;
      if (page <= totalPages) await sleep(300);
    } while (page <= totalPages);

    return { messages: allMessages, replies: allReplies, totalFound };
  }

  private buildQuery(artworkName: string, channelIds: string[], afterDate?: Date): string {
    // in:<#CHANNELID> 여러 개 = OR 로직 (하나라도 포함된 채널)
    const channelFilters = channelIds.map(id => `in:<#${id}>`).join(' ');
    const afterFilter = afterDate ? ` after:${dateToSlackSearchDate(afterDate)}` : '';
    return `"${artworkName}" ${channelFilters}${afterFilter}`;
  }
}
