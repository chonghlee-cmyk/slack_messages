export interface SlackMessage {
  slackTs: string;
  slackChannelId: string;
  slackChannelName: string;
  slackUserId?: string;
  text: string;
  textClean: string;
  permalink: string;
  isReply: false;
  senderName: string;
  isBot: boolean;
  threadTs?: string;
  replyCount: number;
  slackCreatedAt: Date;
  imageUrls: string[];
  imageNames: string[];
  imageBytes: number[];
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
  isReply: true;
  senderName: string;
  isBot: boolean;
  slackCreatedAt: Date;
  imageUrls: string[];
  imageNames: string[];
  imageBytes: number[];
  parentText: string;
  parentPermalink: string;
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
  /** 스레드 부모 메시지에만 존재: 가장 최근 답글의 ts (초.마이크로초 문자열) */
  latest_reply?: string;
  team?: string;
  files?: SlackApiFile[];
}

export interface SlackApiFile {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
  size?: number;
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
