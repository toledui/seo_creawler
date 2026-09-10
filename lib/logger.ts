import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type CrawlLogFields = {
  crawlId?: string;
  pageId?: string;
  url?: string;
  event: string;
  duration?: number;
  status?: number;
  workerId?: string;
};

export function logCrawl(fields: CrawlLogFields, message?: string) {
  logger.info(fields, message ?? fields.event);
}
