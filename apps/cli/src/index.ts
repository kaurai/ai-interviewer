#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseCliArgs, runCli, usage } from './runner';

if (existsSync('.env')) process.loadEnvFile('.env');

try {
  const result = await runCli(parseCliArgs(process.argv.slice(2)));
  process.exitCode = result.exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message !== usage()) console.error(`Error: ${message}`);
  else console.log(message);
  process.exitCode = message === usage() ? 0 : 1;
}
