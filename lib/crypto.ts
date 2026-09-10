import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { env } from './env';

/**
 * Cifrado simétrico para los secretos que se guardan en base de datos:
 * claves de API, contraseña SMTP, client secret de Google y refresh tokens.
 *
 * AES-256-GCM con clave derivada de `AUTH_SECRET`. El formato es
 * `v1:<iv>:<tag>:<datos>` en base64url, así que se puede reconocer un valor
 * cifrado a simple vista y cambiar de esquema más adelante sin ambigüedad.
 *
 * Nota operativa: si cambia `AUTH_SECRET`, los secretos existentes dejan de
 * poder descifrarse y hay que volver a introducirlos. `decrypt` devuelve
 * null en ese caso en lugar de reventar.
 */

const PREFIX = 'v1';

function key(): Buffer {
  return createHash('sha256').update(`seocrawler:${env.authSecret}`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);

  return [
    PREFIX,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decrypt(value: string | null | undefined): string | null {
  if (!value) return null;

  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    // Valor en claro de una versión anterior: se devuelve tal cual para no
    // romper, y se volverá a guardar cifrado en la siguiente escritura.
    return value;
  }

  try {
    const [, iv, tag, data] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** Muestra sólo el final del secreto, para confirmar cuál está guardado. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '••••';
  return `••••${value.slice(-4)}`;
}
