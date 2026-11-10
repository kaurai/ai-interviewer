import { randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

/**
 * The smallest router this API needs, built on `node:http`.
 *
 * Handlers are plain async functions of (request, response, context), so they
 * can be mounted unchanged in Express later (`app.post(path, (req, res) =>
 * handler(req, res, ctx))`). Every error response uses the CONTEXT.md 6.2 shape
 * `{ error: { code, message, retryable } }`.
 */

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** One JSON line per event. Callers must pass only safe, secret-free fields. */
export const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: 'error', event, ...fields })),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface RequestContext {
  requestId: string;
  /** Aborted when the client disconnects before the response finishes. */
  signal: AbortSignal;
  logger: Logger;
}

export type Handler = (req: IncomingMessage, res: ServerResponse, ctx: RequestContext) => Promise<void> | void;

export interface Route {
  method: 'GET' | 'POST';
  path: string;
  handler: Handler;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean };
  [extra: string]: unknown;
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  retryable = false,
  extra: Record<string, unknown> = {},
): void {
  const body: ApiErrorBody = { error: { code, message, retryable }, ...extra };
  sendJson(res, status, body);
}

export function createRequestListener(routes: readonly Route[], logger: Logger = consoleLogger): RequestListener {
  return (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const matches = routes.filter((route) => route.path === pathname);
    const route = matches.find((candidate) => candidate.method === req.method);

    if (!route) {
      // Drain any body so the socket can be reused, then answer.
      req.resume();
      if (matches.length > 0) {
        res.setHeader('allow', matches.map((m) => m.method).join(', '));
        sendError(res, 405, 'method_not_allowed', `Use ${matches.map((m) => m.method).join(' or ')} for ${pathname}.`);
      } else {
        sendError(res, 404, 'not_found', 'No such endpoint.');
      }
      return;
    }

    const ctx: RequestContext = { requestId, signal: controller.signal, logger };
    Promise.resolve()
      .then(() => route.handler(req, res, ctx))
      .catch((error: unknown) => {
        // Log the error class only: messages may embed request data.
        logger.error('http.unhandled_error', { requestId, path: pathname, errorName: (error as Error)?.name ?? 'unknown' });
        sendError(res, 500, 'internal_error', 'Unexpected server error.', true);
      });
  };
}
