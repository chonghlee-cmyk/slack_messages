import * as dotenv from 'dotenv';
import { z } from 'zod';
import * as path from 'path';

dotenv.config();

const sheetsConfigSchema = z.object({
  spreadsheetId: z.string().min(1, 'GOOGLE_SHEETS_SPREADSHEET_ID가 필요합니다'),
  artworkTab: z.string().default('작품관리대장 2.0'),
  outputTab: z.string().default('Slack'),
  artworkNameColumn: z.coerce.number().int().min(0).default(0),
  serviceAccountKeyPath: z.string().optional(),
  serviceAccountKeyBase64: z.string().optional(),
}).refine(
  (data) => data.serviceAccountKeyPath || data.serviceAccountKeyBase64,
  {
    message:
      'GOOGLE_SERVICE_ACCOUNT_KEY_PATH 또는 GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 중 하나가 필요합니다',
  }
);

const slackConfigSchema = z.object({
  botToken: z.string().optional(),
  workspaceDomain: z.string().optional(),
  targetChannelIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
  excludedUserIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
});

const supabaseConfigSchema = z.object({
  url: z.string().url().optional(),
  anonKey: z.string().optional(),
  serviceRoleKey: z.string().optional(),
});

const syncConfigSchema = z.object({
  initialLookbackDays: z.coerce.number().int().positive().default(90),
  searchPageSize: z.coerce.number().int().min(1).max(100).default(20),
  concurrency: z.coerce.number().int().min(1).max(10).default(2),
  artworkDelayMs: z.coerce.number().int().min(0).default(1000),
});

const appConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logFormat: z.enum(['pretty', 'json']).default('pretty'),
});

function loadConfig() {
  const sheets = sheetsConfigSchema.parse({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    artworkTab: process.env.GOOGLE_SHEETS_ARTWORK_TAB,
    outputTab: process.env.GOOGLE_SHEETS_OUTPUT_TAB,
    artworkNameColumn: process.env.GOOGLE_SHEETS_ARTWORK_NAME_COLUMN,
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
      ? path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
      : undefined,
    serviceAccountKeyBase64: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64,
  });

  const slack = slackConfigSchema.parse({
    botToken: process.env.SLACK_BOT_TOKEN,
    workspaceDomain: process.env.SLACK_WORKSPACE_DOMAIN,
    targetChannelIds: process.env.SLACK_TARGET_CHANNEL_IDS,
    excludedUserIds: process.env.SLACK_EXCLUDED_USER_IDS,
  });

  const supabase = supabaseConfigSchema.parse({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const sync = syncConfigSchema.parse({
    initialLookbackDays: process.env.SYNC_INITIAL_LOOKBACK_DAYS,
    searchPageSize: process.env.SLACK_SEARCH_PAGE_SIZE,
    concurrency: process.env.SYNC_CONCURRENCY,
    artworkDelayMs: process.env.SYNC_ARTWORK_DELAY_MS,
  });

  const app = appConfigSchema.parse({
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
    logFormat: process.env.LOG_FORMAT,
  });

  return { sheets, slack, supabase, sync, app };
}

export type Config = ReturnType<typeof loadConfig>;
export const config = loadConfig();
