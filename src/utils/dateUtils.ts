const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function slackTsToDate(ts: string): Date {
  return new Date(parseFloat(ts) * 1000);
}

export function formatDateKST(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTimeKST(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const m = String(kst.getUTCMinutes()).padStart(2, '0');
  const s = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Slack search query에서 after:YYYY-MM-DD 형식으로 사용
export function dateToSlackSearchDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function subtractDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}
