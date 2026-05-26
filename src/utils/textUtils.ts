import * as nodeEmoji from 'node-emoji';

export function cleanMessageText(
  text: string,
  userMap?: Map<string, string>,
  subteamMap?: Map<string, string>
): string {
  return text
    // <@USERID|displayname> → @displayname (Slack embeds name directly)
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, (_, name) => `@${name.split('/')[0].trim()}`)
    // <@USERID> → @ResolvedName or @user
    .replace(/<@([A-Z0-9]+)>/g, (_, userId) => `@${userMap?.get(userId) ?? 'user'}`)
    // <!channel>, <!here>, <!everyone>
    .replace(/<!channel>/g, '@channel')
    .replace(/<!here>/g, '@here')
    .replace(/<!everyone>/g, '@everyone')
    // <!subteam^ID|fallback> → @resolved name (or fallback)
    .replace(/<!subteam\^([A-Z0-9]+)\|([^>]+)>/g, (_, id, fallback) =>
      `@${subteamMap?.get(id) ?? fallback.replace(/^@/, '')}`
    )
    // <!subteam^ID> → @resolved name (or "team")
    .replace(/<!subteam\^([A-Z0-9]+)>/g, (_, id) => `@${subteamMap?.get(id) ?? 'team'}`)
    // <!date^...|fallback> → fallback
    .replace(/<!date\^[^|>]+\|([^>]+)>/g, '$1')
    // <#CHANNELID|channelname> → #channelname
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    // <https://url|text> → text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    // <https://url> → url
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    // :emoji_name: → actual emoji character
    .replace(/:[a-z0-9_\-+]+:/g, match => nodeEmoji.get(match) ?? match)
    // 연속 줄바꿈 정리
    .replace(/\n{3,}/g, '\n\n')
    // HTML entity 디코딩 (Slack은 사용자 입력의 <, >, & 를 &lt; &gt; &amp; 로 escape함)
    // 주의: Slack 특수 마커 <@U123> 등은 이미 위에서 처리됐으므로 안전
    // &amp; 는 마지막 (이중 디코딩 방지)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}
