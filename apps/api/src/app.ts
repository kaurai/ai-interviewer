import { createServer, type Server } from 'node:http';
import type { AppConfig } from './config';
import { consoleLogger, createRequestListener, sendJson, type Logger, type Route } from './http/router';
import { createSttFromConfig, type SttFactoryDeps } from './providers/stt/factory';
import type { SttOrchestrator } from './providers/stt/orchestrator';
import { createAudioRoutes } from './routes/audio';

/**
 * Composition root. Everything external (STT orchestrator, fetch, process
 * runner, logger) can be injected, which is how the tests run the real HTTP
 * stack without credentials or local binaries.
 */

export interface AppOptions {
  config: AppConfig;
  /** Use a prebuilt orchestrator (tests) instead of building one from config. */
  stt?: SttOrchestrator;
  sttDeps?: SttFactoryDeps;
  logger?: Logger;
}

export function createRoutes(options: AppOptions): Route[] {
  const { config } = options;
  const stt = options.stt ?? createSttFromConfig(config.stt, options.sttDeps);
  return [
    {
      method: 'GET',
      path: '/api/health',
      // Configuration summary only; no provider calls and no secrets.
      handler: (_req, res) =>
        sendJson(res, 200, {
          status: 'ok',
          stt: {
            providers: stt.providerIds,
            maxDurationSeconds: config.stt.limits.maxDurationSeconds,
            maxUploadMb: config.stt.limits.maxUploadMb,
          },
        }),
    },
    ...createAudioRoutes({ stt, limits: config.stt.limits }),
  ];
}

export function createApiServer(options: AppOptions): Server {
  return createServer(createRequestListener(createRoutes(options), options.logger ?? consoleLogger));
}
