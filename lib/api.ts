import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, ForbiddenError } from './auth';
import { ForbiddenAccessError, NotFoundAccessError } from './access';
import { serialize } from './prisma';

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(serialize(data), init);
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ error: message, details: extra }, { status });
}

/** Envoltorio común de errores para los Route Handlers. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, 401);
    if (err instanceof ForbiddenError) return fail(err.message, 403);
    if (err instanceof ForbiddenAccessError) return fail(err.message, 403);
    if (err instanceof NotFoundAccessError) return fail(err.message, 404);
    if (err instanceof ZodError)
      return fail('Datos inválidos', 422, err.flatten());
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[api]', err);
    return fail(message, 500);
  }
}
