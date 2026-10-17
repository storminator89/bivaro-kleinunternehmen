import { spawn } from 'node:child_process';
import { constants } from 'node:os';

export async function runE2eProcess({ args, env, prepare, cleanup }) {
  let child;
  let shutdownSignal;
  const forwardSignal = (signal) => {
    shutdownSignal ??= signal;
    process.exitCode = 128 + constants.signals[shutdownSignal];
    child?.kill(signal);
  };
  const onInterrupt = () => forwardSignal('SIGINT');
  const onTerminate = () => forwardSignal('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    await prepare?.();
    if (shutdownSignal) return;
    child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', ...args], {
      stdio: 'inherit',
      env,
    });
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const signal = shutdownSignal ?? result.signal;
    process.exitCode = signal ? 128 + constants.signals[signal] : result.code ?? 1;
  } finally {
    try {
      await cleanup();
    } finally {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
}
