import { ProcessSpawnError, spawnProcess, type ProcessRunner } from '../../api/src/providers/stt/processRunner';
import type { PipelineConfig, TtsProviderId } from '../../api/src/pipelineConfig';

export interface SpeechOutput {
  readonly id: TtsProviderId;
  speak(text: string): Promise<void>;
  checkReadiness(): Promise<{ ready: boolean; detail: string }>;
}

const DEFAULT_COMMAND: Record<Exclude<TtsProviderId, 'none'>, string> = {
  say: 'say',
  espeak: 'espeak',
  'spd-say': 'spd-say',
};

export function createSpeechOutput(
  config: PipelineConfig['tts'],
  deps: { runProcess?: ProcessRunner } = {},
): SpeechOutput {
  const run = deps.runProcess ?? spawnProcess;
  if (config.provider === 'none') {
    return {
      id: 'none',
      async speak() {},
      async checkReadiness() { return { ready: true, detail: 'text output only' }; },
    };
  }
  const id = config.provider;
  const command = config.command ?? DEFAULT_COMMAND[id];
  const argsFor = (text: string): string[] => (id === 'say' ? ['--', text] : id === 'espeak' ? ['--', text] : ['--wait', '--', text]);
  return {
    id,
    async speak(text) {
      try {
        const result = await run(command, argsFor(text), { timeoutMs: config.timeoutMs });
        if (result.timedOut) throw new Error(`${id} timed out`);
        if (result.exitCode !== 0) throw new Error(`${id} exited with code ${result.exitCode}`);
      } catch (error) {
        if (error instanceof ProcessSpawnError) throw new Error(`${id} is unavailable; use CLI_TTS_PROVIDER=none or install the command.`);
        throw error;
      }
    },
    async checkReadiness() {
      try {
        await run(command, id === 'say' ? ['--version'] : ['--version'], { timeoutMs: Math.min(config.timeoutMs, 5000) });
        return { ready: true, detail: `${command} is runnable` };
      } catch (error) {
        const detail = error instanceof ProcessSpawnError ? error.code : 'failed';
        return { ready: false, detail: `${command} is not runnable (${detail})` };
      }
    },
  };
}
