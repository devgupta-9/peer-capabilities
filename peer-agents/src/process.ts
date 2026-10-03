import { spawn } from 'node:child_process';
import { childEnvironment } from './security.js';

export type CaptureResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
};

const DEFAULT_MAX_OUTPUT_BYTES = 262_144;
const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_SECONDS = 1800;

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function truncate(value: string, maxBytes = DEFAULT_MAX_OUTPUT_BYTES): string {
  const limit = positiveInteger(maxBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= limit) return value;
  return `${buffer.subarray(0, limit).toString('utf8')}\n\n[truncated by peer-agents after ${limit} bytes]`;
}

function killProcessTree(child: ReturnType<typeof spawn>) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.unref();
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Best effort only.
    }
  }
}

function captureChunk(
  chunks: Buffer[],
  chunk: Buffer,
  currentBytes: number,
  maxBytes: number,
): { bytes: number; truncated: boolean } {
  if (currentBytes >= maxBytes) return { bytes: currentBytes, truncated: chunk.length > 0 };
  const remaining = maxBytes - currentBytes;
  const kept = chunk.subarray(0, remaining);
  if (kept.length) chunks.push(kept);
  return {
    bytes: currentBytes + kept.length,
    truncated: chunk.length > kept.length,
  };
}

function decodeCaptured(chunks: Buffer[], truncated: boolean, maxBytes: number): string {
  const value = Buffer.concat(chunks).toString('utf8');
  return truncated ? `${value}\n\n[truncated by peer-agents after ${maxBytes} bytes]` : value;
}

export async function runCapture(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutSeconds?: number;
    env?: NodeJS.ProcessEnv;
    input?: string | Buffer;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<CaptureResult> {
  const started = Date.now();
  const timeoutSeconds = Math.min(
    Math.max(positiveInteger(options.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS), 1),
    MAX_TIMEOUT_SECONDS,
  );
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes ?? process.env.PEER_AGENTS_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_BYTES,
  );

  return await new Promise<CaptureResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? childEnvironment(),
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // A CLI may reject input and close stdin before the complete prompt is sent.
    child.stdin?.on('error', () => { /* completion/error is reported by the child */ });
    child.stdin?.end(options.input);

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutSeconds * 1000);
    const abort = () => { cancelled = true; killProcessTree(child); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    child.stdout?.on('data', (chunk: Buffer) => {
      const captured = captureChunk(stdoutChunks, chunk, stdoutBytes, maxOutputBytes);
      stdoutBytes = captured.bytes;
      stdoutTruncated ||= captured.truncated;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const captured = captureChunk(stderrChunks, chunk, stderrBytes, maxOutputBytes);
      stderrBytes = captured.bytes;
      stderrTruncated ||= captured.truncated;
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve({
        code,
        stdout: decodeCaptured(stdoutChunks, stdoutTruncated, maxOutputBytes),
        stderr: decodeCaptured(stderrChunks, stderrTruncated, maxOutputBytes),
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
      });
    });
  });
}
