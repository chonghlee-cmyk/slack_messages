import pino from 'pino';

const isDev =
  process.env.NODE_ENV !== 'production' && process.env.LOG_FORMAT !== 'json';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['*.token', '*.key', '*.secret', '*.password', 'SLACK_BOT_TOKEN', 'serviceRoleKey'],
      censor: '[REDACTED]',
    },
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : undefined
);
