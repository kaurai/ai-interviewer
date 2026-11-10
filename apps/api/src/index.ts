/**
 * API entry point: `npm run dev:api` (watch) or `npm run start:api`.
 *
 * Loads `.env` from the repository root when present (Node's built-in
 * `process.loadEnvFile`), validates configuration, and binds to 127.0.0.1 by
 * default so the server is not reachable from the network.
 */
import { existsSync } from 'node:fs';
import { createApiServer } from './app';
import { ConfigError, describeSttConfig, loadConfig, type AppConfig } from './config';
import { consoleLogger } from './http/router';

if (existsSync('.env')) process.loadEnvFile('.env');

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`${error.message}\nFix .env (see .env.example), then run npm run doctor.`);
      process.exit(1);
    }
    throw error;
  }
}

const config = loadConfigOrExit();

const { host, port } = config.server;
const server = createApiServer({ config, logger: consoleLogger });
server.once('error', (error: NodeJS.ErrnoException) => {
  // e.g. EADDRINUSE or EACCES; report the code, not a stack trace.
  consoleLogger.error('api.listen_failed', { host, port, code: error.code ?? error.name });
  process.exit(1);
});
server.listen(port, host, () => {
  const stt = describeSttConfig(config.stt);
  consoleLogger.info('api.listening', {
    url: `http://${host}:${port}`,
    stt: { primary: stt.primary, fallback: stt.fallback, elevenLabsKey: stt.elevenLabs.apiKey },
  });
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
