import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ALLOWED_PROTOCOLS } from './normalize-url';
import { env } from '../../lib/env';

export class BlockedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedHostError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

const PRIVATE_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8',
  '169.254.0.0/16', // link-local / metadata cloud
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reservado
];

/** true si la IP no debe ser alcanzada por el crawler. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) return PRIVATE_V4.some((cidr) => inCidr(ip, cidr));

  if (version === 6) {
    const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === '::' || normalized === '::1') return true;
    // IPv4 mapeada: ::ffff:127.0.0.1
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    // fc00::/7 (ULA), fe80::/10 (link-local)
    if (/^f[cd]/.test(normalized)) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    return false;
  }

  return true;
}

/**
 * Valida protocolo + hostname resolviendo DNS.
 *
 * Se llama antes de cada request y de nuevo tras cada redirect, lo que
 * mitiga el DNS rebinding (sección 48 del plan).
 */
export async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedHostError('URL inválida');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new BlockedHostError(`Protocolo no permitido: ${parsed.protocol}`);
  }

  if (env.crawler.allowPrivateHosts) return;

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new BlockedHostError(`Host bloqueado: ${hostname}`);
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new BlockedHostError(`IP privada bloqueada: ${hostname}`);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedHostError(`No se pudo resolver DNS: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new BlockedHostError(`Sin registros DNS: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new BlockedHostError(
        `${hostname} resuelve a una IP privada (${address})`,
      );
    }
  }
}
