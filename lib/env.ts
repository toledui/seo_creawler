function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  authSecret: process.env.AUTH_SECRET || 'dev-insecure-secret-change-me',

  crawler: {
    userAgent:
      process.env.CRAWLER_USER_AGENT ||
      'SeoCrawlerBot/0.1 (+http://localhost:3000)',
    maxConcurrency: num(process.env.CRAWLER_MAX_CONCURRENCY, 10),
    timeoutMs: num(process.env.CRAWLER_TIMEOUT_MS, 15_000),
    maxRedirects: num(process.env.CRAWLER_MAX_REDIRECTS, 10),
    maxHtmlBytes: num(process.env.CRAWLER_MAX_HTML_BYTES, 5 * 1024 * 1024),
    allowPrivateHosts: process.env.CRAWLER_ALLOW_PRIVATE_HOSTS === 'true',
  },

  worker: {
    pollMs: num(process.env.WORKER_POLL_MS, 2000),
    id: process.env.WORKER_ID || `worker-${process.pid}`,
  },

  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  },
};

export const aiEnabled = () => Boolean(env.deepseek.apiKey);
