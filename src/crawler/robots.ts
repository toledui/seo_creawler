import robotsParser, { type Robot } from 'robots-parser';
import { fetchPage } from './fetch-page';

export type RobotsInfo = {
  robotsUrl: string;
  fetched: boolean;
  robot: Robot | null;
  sitemaps: string[];
};

/**
 * Descarga y parsea /robots.txt del origen indicado.
 * Si no existe o falla, se asume "todo permitido" (comportamiento estándar).
 */
export async function loadRobots(
  origin: string,
  userAgent: string,
): Promise<RobotsInfo> {
  const robotsUrl = new URL('/robots.txt', origin).toString();

  const result = await fetchPage(robotsUrl, { userAgent, readBody: 'always' });

  if (result.errorType && result.errorType !== 'UNSUPPORTED_CONTENT') {
    return { robotsUrl, fetched: false, robot: null, sitemaps: [] };
  }
  if (!result.statusCode || result.statusCode >= 400 || !result.body) {
    return { robotsUrl, fetched: false, robot: null, sitemaps: [] };
  }

  const robot = robotsParser(robotsUrl, result.body);
  const sitemaps = (robot.getSitemaps() ?? []).filter(Boolean);

  return { robotsUrl, fetched: true, robot, sitemaps };
}

export function isAllowed(
  info: RobotsInfo,
  url: string,
  userAgent: string,
): boolean {
  if (!info.robot) return true;
  const allowed = info.robot.isAllowed(url, userAgent);
  // `undefined` significa que no hay regla aplicable.
  return allowed !== false;
}

export function crawlDelayOf(
  info: RobotsInfo,
  userAgent: string,
): number | null {
  if (!info.robot) return null;
  const delay = info.robot.getCrawlDelay(userAgent);
  return typeof delay === 'number' && delay > 0 ? delay * 1000 : null;
}
