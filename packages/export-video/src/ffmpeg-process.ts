import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { isAbsolute, resolve, parse, extname } from 'node:path';

export interface FFmpegProcessSettings {
  width: number;
  height: number;
  firstNumber: number;
  frameCount: number;
  rate: number;
  scale: number;
  audio: boolean;
}
export interface FFmpegProcessLocation {
  executable: string;
  directory: string;
}
export interface FFmpegProcessPlan {
  metadata(): FFmpegProcessSettings & FFmpegProcessLocation;
  dispose(): void;
}
export type FFmpegSpawn = (
  executable: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;
type Owner = {
  settings: FFmpegProcessSettings;
  location: FFmpegProcessLocation;
  verify(): void;
  disposed: boolean;
  busy: boolean;
  reentered: boolean;
  checking: boolean;
  cancel?: (error: unknown) => void;
};
const owners = new WeakMap<object, Owner>(),
  maximum = 512 * 1024 * 1024;
const valid = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
function fields(value: object, allowed: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.includes(key))
  )
    throw Error('Unexpected FFmpeg process request fields.');
}
let preparing = false,
  preparationReentered = false;
/** Node-only process capability. The mandatory synchronous validator owns an
 * explicitly selected executable and already admitted isolated PNG/WAV staging.
 * This module does not authorize filesystem paths, stage/delete files or expose
 * an endpoint. Public metadata/suggested command strings never own execution.
 */
export function prepareFFmpegProcess(
  settings: FFmpegProcessSettings,
  location: FFmpegProcessLocation,
  validate: () => void,
): FFmpegProcessPlan {
  if (preparing) {
    preparationReentered = true;
    throw Error('FFmpeg preparation reentered.');
  }
  preparing = true;
  preparationReentered = false;
  try {
    fields(settings, ['width', 'height', 'firstNumber', 'frameCount', 'rate', 'scale', 'audio']);
    fields(location, ['executable', 'directory']);
    const { width, height, firstNumber, frameCount, rate, scale, audio } = settings,
      { executable, directory } = location;
    if (
      !valid(width, 1, 16384) ||
      !valid(height, 1, 16384) ||
      width * height > 64 * 1024 * 1024 ||
      !valid(firstNumber, 1, 2147483647) ||
      !valid(frameCount, 1, 65534 - 2 - (audio === true ? 1 : 0)) ||
      firstNumber + frameCount - 1 > 2147483647 ||
      !valid(rate, 1, 2147483647) ||
      !valid(scale, 1, 2147483647) ||
      rate / scale < 1 ||
      rate / scale > 240 ||
      typeof audio !== 'boolean' ||
      typeof validate !== 'function'
    )
      throw Error('Invalid FFmpeg process timing, dimensions or staging count.');
    if (
      [executable, directory].some(
        (value) =>
          typeof value !== 'string' ||
          !value ||
          value.length > 32767 ||
          /[\0\r\n]/.test(value) ||
          !isAbsolute(value),
      ) ||
      /\.(?:bat|cmd)$/i.test(executable) ||
      resolve(directory) === parse(resolve(directory)).root ||
      (!extname(executable) && process.platform === 'win32')
    )
      throw Error('Explicit absolute executable and non-root isolated staging paths are required.');
    const data = { width, height, firstNumber, frameCount, rate, scale, audio },
      paths = { executable, directory };
    const owner: Owner = {
      settings: data,
      location: paths,
      disposed: false,
      busy: false,
      reentered: false,
      checking: false,
      verify() {
        if (owner.disposed) throw Error('FFmpeg process plan disposed.');
        if (owner.checking) {
          owner.reentered = true;
          throw Error('FFmpeg source admission reentered.');
        }
        owner.checking = true;
        try {
          const result = validate() as unknown;
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            void Promise.resolve(result).catch(() => {});
            throw Error('FFmpeg source validation must be synchronous.');
          }
          if (owner.disposed || owner.reentered || (preparing && preparationReentered))
            throw Error('FFmpeg source admission changed or reentered.');
        } finally {
          owner.checking = false;
        }
      },
    };
    owner.verify();
    const plan = Object.freeze({
      metadata() {
        if (!owner.busy && !owner.checking) owner.reentered = false;
        owner.verify();
        const result = { ...data, ...paths };
        owner.verify();
        return result;
      },
      dispose() {
        if (owner.checking) {
          owner.reentered = true;
          throw Error('FFmpeg disposal reentered.');
        }
        owner.disposed = true;
        owner.cancel?.(Error('FFmpeg process plan disposed.'));
      },
    });
    owner.verify();
    owners.set(plan, owner);
    return plan;
  } finally {
    preparing = false;
  }
}
function argumentsFor(s: FFmpegProcessSettings) {
  const args = [
    '-hide_banner',
    '-xerror',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'error',
    '-n',
    '-protocol_whitelist',
    'file,pipe',
    '-framerate',
    `${s.rate}/${s.scale}`,
    '-pattern_type',
    'sequence',
    '-start_number',
    String(s.firstNumber),
    '-start_number_range',
    '1',
    '-i',
    'frame-%06d.png',
  ];
  if (s.audio) args.push('-protocol_whitelist', 'file,pipe', '-i', 'audio.wav');
  args.push(
    '-map',
    '0:v:0',
    ...(s.audio ? ['-map', '1:a:0'] : []),
    '-frames:v',
    String(s.frameCount),
    '-c:v',
    'ffv1',
    '-pix_fmt',
    'bgra',
    ...(s.audio ? ['-c:a', 'pcm_s16le'] : []),
    '-f',
    'matroska',
    'pipe:1',
  );
  return args;
}
const Bytes = Uint8Array,
  typed = Object.getPrototypeOf(Bytes.prototype),
  byteLength = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!,
  buffer = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!,
  offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!,
  set = Bytes.prototype.set;
function copy(chunk: unknown, limit: number) {
  if (!(chunk instanceof Bytes)) throw Error('FFmpeg streams must deliver binary bytes.');
  const size = byteLength.call(chunk) as number,
    storage = buffer.call(chunk) as ArrayBuffer;
  if (!(storage instanceof ArrayBuffer) || !valid(size, 1, limit))
    throw Error('FFmpeg stream exceeded its byte budget.');
  const output = new Bytes(size);
  set.call(output, new Bytes(storage, offset.call(chunk), size));
  return output;
}
/** Runs only the original private capability, with no shell/stdin/window and
 * fixed local inputs/output pipe. Cancellation kills the direct child and waits
 * for close (including stdio), not merely exit. Uncooperative OS cleanup may
 * delay rejection: callers must retain staging until settlement. No process
 * tree sandbox, staging validation, codec/fidelity certification or publication.
 */
export async function runFFmpegProcess(
  plan: object,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    maxDiagnostics?: number;
  } = {},
  spawn: FFmpegSpawn = nodeSpawn,
) {
  const started = performance.now(),
    owner = owners.get(plan);
  if (!owner) throw Error('An original FFmpeg process plan is required.');
  if (owner.busy) {
    owner.reentered = true;
    owner.cancel?.(Error('FFmpeg process plan reentered.'));
    throw Error('FFmpeg process plan is already running.');
  }
  owner.busy = true;
  owner.reentered = false;
  let child: ChildProcess | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { signal, timeoutMs = 60000, maxBytes = maximum, maxDiagnostics = 256 * 1024 } = options;
    if (
      !valid(timeoutMs, 1, 60000) ||
      !valid(maxBytes, 1, maximum) ||
      !valid(maxDiagnostics, 1, 1024 * 1024) ||
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      typeof spawn !== 'function'
    )
      throw Error('Invalid FFmpeg process limits or dependencies.');
    const Spawn = spawn,
      args = argumentsFor(owner.settings),
      { executable, directory } = owner.location;
    const env: NodeJS.ProcessEnv = {
      LANG: 'C',
      LC_ALL: 'C',
      TEMP: directory,
      TMP: directory,
      AV_LOG_FORCE_NOCOLOR: '1',
    };
    for (const key of ['SystemRoot', 'WINDIR'])
      if (typeof process.env[key] === 'string') env[key] = process.env[key];
    let failure: unknown,
      terminating = false,
      closed = false,
      outputting = false,
      count = 0,
      diagnosticBytes = 0;
    const chunks: Uint8Array[] = [],
      diagnostics: Uint8Array[] = [];
    const check = () => {
      if (failure !== undefined) throw failure;
      signal?.throwIfAborted();
      if (performance.now() - started >= timeoutMs) throw Error('FFmpeg process timed out.');
      owner.verify();
      if (failure !== undefined) throw failure;
      signal?.throwIfAborted();
      if (performance.now() - started >= timeoutMs) throw Error('FFmpeg process timed out.');
    };
    check();
    return await new Promise<{
      bytes: Uint8Array;
      byteLength: number;
      diagnostics: string;
      requested: Readonly<FFmpegProcessSettings>;
    }>((resolve, reject) => {
      const fail = (error: unknown) => {
        if (closed) return;
        if (failure === undefined) failure = error ?? Error('FFmpeg process failed.');
        chunks.length = 0;
        diagnostics.length = 0;
        if (child && !terminating) {
          terminating = true;
          try {
            child.kill('SIGKILL');
          } catch (kill) {
            failure = new AggregateError(
              [failure, kill],
              'FFmpeg process failed and termination failed.',
            );
          }
        }
      };
      const abort = () => fail(signal?.reason ?? Error('FFmpeg process cancelled.'));
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        owner.cancel = undefined;
        child?.off('error', onError);
        child?.off('close', onClose);
        child?.stdout?.off('data', onOutput);
        child?.stderr?.off('data', onDiagnostics);
        child?.stdout?.off('error', onError);
        child?.stderr?.off('error', onError);
      };
      const onError = (error: unknown) => fail(error);
      const collect = (value: unknown, diagnostic: boolean) => {
        if (closed || failure !== undefined) return;
        if (outputting) {
          fail(Error('FFmpeg output admission reentered.'));
          return;
        }
        outputting = true;
        try {
          check();
          const owned = copy(
            value,
            diagnostic ? maxDiagnostics - diagnosticBytes : maxBytes - count,
          );
          check();
          if (diagnostic) {
            diagnostics.push(owned);
            diagnosticBytes += owned.length;
          } else {
            chunks.push(owned);
            count += owned.length;
          }
        } catch (error) {
          fail(error);
        } finally {
          outputting = false;
        }
      };
      const onOutput = (value: unknown) => collect(value, false),
        onDiagnostics = (value: unknown) => collect(value, true);
      const onClose = (code: number | null, termination: NodeJS.Signals | null) => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          if (failure !== undefined) throw failure;
          check();
          if (code !== 0 || termination !== null)
            throw Error(
              `FFmpeg process closed unsuccessfully (${code ?? termination ?? 'unknown'}).`,
            );
          if (count < 4) throw Error('FFmpeg produced no complete container output.');
          const bytes = new Bytes(count);
          let at = 0;
          for (const part of chunks) {
            set.call(bytes, part, at);
            at += part.length;
          }
          const diagnostic = new Bytes(diagnosticBytes);
          at = 0;
          for (const part of diagnostics) {
            set.call(diagnostic, part, at);
            at += part.length;
          }
          if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3)
            throw Error('FFmpeg output lacks the Matroska EBML header.');
          check();
          const result = {
            bytes,
            byteLength: count,
            diagnostics: new TextDecoder().decode(diagnostic),
            // Requested settings are not a decoded frame/sample-count receipt.
            requested: Object.freeze({ ...owner.settings }),
          };
          check();
          const output = Object.freeze(result);
          check();
          resolve(output);
        } catch (error) {
          reject(error);
        } finally {
          chunks.length = 0;
          diagnostics.length = 0;
        }
      };
      try {
        owner.cancel = fail;
        signal?.addEventListener('abort', abort, { once: true });
        check();
        child = Spawn(executable, args, {
          cwd: directory,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: false,
          detached: false,
        });
        child.on('error', onError);
        child.on('close', onClose);
        if (!child.stdout || !child.stderr)
          throw Error('FFmpeg requires original binary stdout/stderr pipes.');
        child.stdout.on('data', onOutput);
        child.stderr.on('data', onDiagnostics);
        child.stdout.on('error', onError);
        child.stderr.on('error', onError);
        timer = setTimeout(
          () => fail(Error('FFmpeg process timed out.')),
          Math.max(1, Math.ceil(timeoutMs - (performance.now() - started))),
        );
        check();
      } catch (error) {
        if (child) {
          fail(error);
        } else {
          closed = true;
          cleanup();
          reject(error);
        }
      }
    });
  } finally {
    owner.busy = false;
    owner.reentered = false;
  }
}
