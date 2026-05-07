export interface SlackMessage {
  slackTs: string;
  slackChannelId: string;
  slackChannelName: string;
  slackUserId?: string;
  text: string;
  textClean: string;
  permalink: string;
  artworkName: string;
  senderName: string;
  isBot: boolean;
  threadTs?: string;
  replyCount: number;
  slackCreatedAt: Date;
}

export interface ThreadReply {
  parentMessageTs: string;
  slackThreadTs: string;
  slackTs: string;
  slackChannelId: string;
  slackChannelName: string;
  text: string;
  textClean: string;
  permalink: string;
  senderName: string;
  isBot: boolean;
  slackCreatedAt: Date;
  artworkName: string;
}

// Slack API raw 응답 타입 (우리가 사용하는 필드만)
export interface SlackApiMessage {
  type?: string;
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  subtype?: string;
  channel?: { id: string; name: string };
  permalink?: string;
  thread_ts?: string;
  reply_count?: number;
  reply_users_count?: number;
  team?: string;
}

export interface SlackSearchResponse {
  ok: boolean;
  messages: {
    total: number;
    paging: {
      count: number;
      total: number;
      page: number;
      pages: number;
    };
    matches: SlackApiMessage[];
  };
}
