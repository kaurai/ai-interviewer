import type { IncomingMessage } from 'node:http';

/**
 * In-memory multipart parsing with Node built-ins only.
 *
 * 1. Stream the body into memory and stop buffering as soon as the byte limit
 *    is exceeded, so oversized uploads are never held in memory.
 * 2. Keep draining (discarding) an oversized body until it ends, so the client
 *    can read the 413 response, but destroy the connection past a hard cap.
 * 3. Hand the bounded buffer to the WHATWG `Response.formData()` parser.
 *
 * Nothing touches disk.
 */

export class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError';
}

export class MalformedMultipartError extends Error {
  override readonly name = 'MalformedMultipartError';
}

export class UnsupportedContentTypeError extends Error {
  override readonly name = 'UnsupportedContentTypeError';
}

/** Room for multipart boundaries, part headers, and small text fields. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function readBodyWithLimit(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  // Beyond this, stop being polite and drop the connection.
  const hardCap = maxBytes * 2 + 1024 * 1024;
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > hardCap) {
    req.resume();
    throw new BodyTooLargeError(`Body exceeds ${maxBytes} bytes`);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (tooLarge) {
        if (total > hardCap) {
          cleanup();
          req.destroy();
          reject(new BodyTooLargeError(`Body exceeds ${maxBytes} bytes`));
        }
        return;
      }
      if (total > maxBytes) {
        tooLarge = true;
        chunks.length = 0; // release what was buffered
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      if (tooLarge) reject(new BodyTooLargeError(`Body exceeds ${maxBytes} bytes`));
      else resolve(Buffer.concat(chunks, total));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    // A client that disconnects mid-upload may close the stream without `end`
    // or `error`; settle anyway so the handler never waits forever.
    const onClose = () => {
      cleanup();
      reject(new Error('Request closed before the body was fully received'));
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

export async function parseMultipartForm(req: IncomingMessage, maxBytes: number): Promise<FormData> {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary=/i.test(contentType)) {
    req.resume();
    throw new UnsupportedContentTypeError('Expected multipart/form-data with a boundary');
  }
  const body = await readBodyWithLimit(req, maxBytes);
  try {
    return await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new MalformedMultipartError('Could not parse multipart body');
  }
}
