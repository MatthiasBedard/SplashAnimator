import fsNative, { promises as fs, type BigIntStats } from 'node:fs';
import { isAbsolute, resolve, parse, join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export interface FFmpegExecutableOptions {
  validate: (selectedPath: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}
export interface FFmpegExecutable {
  metadata(): { path: string; canonicalPath: string; byteLength: number; sha256: string };
  /** Retires only the capability; never deletes/modifies the selected program. */
  dispose(): void;
}
type Owner = {
  verify(full: boolean): void;
  metadata: FFmpegExecutable['metadata'];
  dispose(): void;
  signal(): AbortSignal;
  path: string;
};
const owners = new WeakMap<object, Owner>(),
  maximum = 512 * 1024 * 1024;
let capturing = false,
  captureReentered = false,
  authorizing: { reentered: boolean } | undefined;
const sameIdentity = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size;
const sameStamp = (a: BigIntStats, b: BigIntStats) =>
  sameIdentity(a, b) && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
/** Explicit file capture only: no PATH search, command interpretation, install,
 * execution or binary-format/FFmpeg-version certification. SHA admission is not
 * a signature of publisher trust or an OS-level execution sandbox. */
export async function prepareFFmpegExecutable(
  path: string,
  options: FFmpegExecutableOptions,
): Promise<FFmpegExecutable> {
  if (capturing || authorizing) {
    if (capturing) captureReentered = true;
    if (authorizing) authorizing.reentered = true;
    throw Error('FFmpeg program capture reentered.');
  }
  capturing = true;
  captureReentered = false;
  const started = performance.now(),
    Controller = AbortController,
    abort = Controller.prototype.abort,
    throwIfAborted = AbortSignal.prototype.throwIfAborted,
    add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener,
    reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!,
    io = {
      open: fs.open,
      lstat: fsNative.lstatSync,
      realpath: fsNative.realpathSync,
      openSync: fsNative.openSync,
      readSync: fsNative.readSync,
      statSync: fsNative.fstatSync,
      closeSync: fsNative.closeSync,
    };
  let selected: string,
    canonical: string,
    original: BigIntStats,
    stamp: BigIntStats,
    signature: string,
    bytes: number;
  let validate: (selectedPath: string) => void,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    maxBytes: number;
  let checking = false,
    reentered = false,
    disposed = false;
  let phaseStarted = started;
  const noLinks = () => {
    const root = parse(selected).root;
    let at = root;
    for (const part of selected.slice(root.length).split(/[\\/]/).filter(Boolean)) {
      at = join(at, part);
      if (io.lstat(at).isSymbolicLink())
        throw Error('Selected FFmpeg program paths cannot contain links.');
    }
  };
  const control = () => {
    if (disposed) throw Error('FFmpeg program disposed.');
    if (signal) throwIfAborted.call(signal);
    if (performance.now() - phaseStarted >= timeoutMs)
      throw Error('FFmpeg program admission timed out.');
  };
  const source = () => {
    control();
    const gate = { reentered: false };
    if (authorizing) {
      authorizing.reentered = true;
      throw Error('FFmpeg program authority reentered.');
    }
    authorizing = gate;
    try {
      const result = validate(path) as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('FFmpeg program authority must be synchronous.');
      }
      if (reentered || gate.reentered || (capturing && captureReentered))
        throw Error('FFmpeg program admission reentered.');
      control();
    } finally {
      authorizing = undefined;
    }
  };
  const file = (checkStamp: boolean) => {
    noLinks();
    const now = io.lstat(selected, { bigint: true });
    if (
      !now.isFile() ||
      now.isSymbolicLink() ||
      now.nlink !== 1n ||
      !sameIdentity(now, original) ||
      io.realpath(selected) !== canonical
    )
      throw Error('Selected FFmpeg program identity changed.');
    if (checkStamp && !sameStamp(now, stamp))
      throw Error('Selected FFmpeg program changed since content admission.');
    return now;
  };
  try {
    if (
      typeof path !== 'string' ||
      !path ||
      path.length > 32767 ||
      /[\0\r\n]/.test(path) ||
      !isAbsolute(path) ||
      /\.(?:bat|cmd)$/i.test(path) ||
      (process.platform === 'win32' && !extname(path)) ||
      path
        .slice(parse(path).root.length)
        .split(/[\\/]/)
        .some((part) => part === '.' || part === '..')
    )
      throw Error('An explicit absolute selected program file is required.');
    selected = resolve(path);
    noLinks();
    canonical = io.realpath(selected);
    original = io.lstat(selected, { bigint: true });
    stamp = original;
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some(
        (key) =>
          typeof key !== 'string' || !['validate', 'signal', 'timeoutMs', 'maxBytes'].includes(key),
      )
    )
      throw Error('Unexpected FFmpeg program options.');
    ({ validate, signal, timeoutMs = 60000, maxBytes = maximum } = options);
    if (
      typeof validate !== 'function' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > maximum ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw Error('Invalid FFmpeg program authority or limits.');
    if (
      !original.isFile() ||
      original.nlink !== 1n ||
      original.size < 1n ||
      original.size > BigInt(maxBytes)
    )
      throw Error('Selected FFmpeg program exceeds its regular-file byte budget.');
    bytes = Number(original.size);
    source();
    file(true);
  } finally {
    capturing = false;
  }
  // The original identity above precedes the first await. IO settles before close,
  // including cancellation during an uncooperative native open/read.
  checking = true;
  try {
    const handle = await io.open(selected, 'r'),
      close = handle.close;
    let failed = false,
      failure: unknown;
    try {
      const read = handle.read,
        stat = handle.stat;
      source();
      file(true);
      const before = (await stat.call(handle, { bigint: true })) as BigIntStats;
      if (!sameStamp(before, original) || before.nlink !== 1n)
        throw Error('Opened FFmpeg program changed.');
      const hash = createHash('sha256'),
        buffer = new Uint8Array(Math.min(65536, bytes + 1));
      let at = 0;
      while (true) {
        source();
        file(true);
        const wanted = Math.min(buffer.length, bytes - at + 1),
          result = await read.call(handle, { buffer, offset: 0, length: wanted, position: at }),
          n = result.bytesRead;
        source();
        if (!Number.isSafeInteger(n) || n < 0 || n > wanted || at + n > bytes)
          throw Error('FFmpeg program read exceeded its original byte budget.');
        if (n === 0) break;
        hash.update(buffer.subarray(0, n));
        at += n;
      }
      const after = (await stat.call(handle, { bigint: true })) as BigIntStats;
      if (at !== bytes || !sameStamp(after, before))
        throw Error('Incomplete or changed selected FFmpeg program.');
      signature = hash.digest('hex');
      source();
      file(true);
    } catch (error) {
      failed = true;
      failure = error;
      throw error;
    } finally {
      try {
        await close.call(handle);
      } catch (error) {
        if (failed)
          throw new AggregateError(
            [failure, error],
            'FFmpeg program capture and handle cleanup failed.',
          );
        throw error;
      }
    }
    source();
    file(true);
  } finally {
    checking = false;
  }
  const controller = new Controller();
  const abortSource = () => abort.call(controller, reason.call(signal!));
  const verify = (full: boolean, restart = true) => {
    if (checking) {
      reentered = true;
      throw Error('FFmpeg program verification reentered.');
    }
    checking = true;
    reentered = false;
    if (restart) phaseStarted = performance.now();
    try {
      source();
      const before = file(!full);
      if (full) {
        const fd = io.openSync(selected, 'r');
        let failed = false,
          failure: unknown;
        try {
          const opened = io.statSync(fd, { bigint: true });
          if (!sameStamp(opened, before) || opened.nlink !== 1n)
            throw Error('Opened FFmpeg program identity changed.');
          const hash = createHash('sha256'),
            buffer = new Uint8Array(Math.min(65536, bytes + 1));
          let at = 0;
          while (true) {
            control();
            const wanted = Math.min(buffer.length, bytes - at + 1),
              n = io.readSync(fd, buffer, 0, wanted, at);
            if (!Number.isSafeInteger(n) || n < 0 || n > wanted || at + n > bytes)
              throw Error('FFmpeg program content exceeded its original budget.');
            if (n === 0) break;
            hash.update(buffer.subarray(0, n));
            at += n;
          }
          const after = io.statSync(fd, { bigint: true });
          if (at !== bytes || !sameStamp(before, after) || hash.digest('hex') !== signature)
            throw Error('Selected FFmpeg program content changed.');
        } catch (error) {
          failed = true;
          failure = error;
          throw error;
        } finally {
          try {
            io.closeSync(fd);
          } catch (error) {
            if (failed)
              throw new AggregateError(
                [failure, error],
                'FFmpeg program verification and handle cleanup failed.',
              );
            throw error;
          }
        }
        source();
        const after = file(false);
        if (!sameStamp(before, after))
          throw Error('Selected FFmpeg program changed during verification.');
        // Only an exact original identity/content match can refresh a stamp.
        stamp = after;
      }
      source();
      file(true);
    } finally {
      checking = false;
    }
  };
  const owner: Owner = {
    path,
    verify,
    metadata() {
      verify(true);
      const result = { path, canonicalPath: canonical, byteLength: bytes, sha256: signature };
      verify(false, false);
      return result;
    },
    signal() {
      // Obtaining cancellation provenance never admits program bytes. The
      // coordinator's initial full verification must be able to requalify exact
      // restored content before cheap stamp checks resume.
      if (disposed) throw Error('FFmpeg program disposed.');
      if (signal) throwIfAborted.call(signal);
      return controller.signal;
    },
    dispose() {
      if (checking) {
        reentered = true;
        throw Error('FFmpeg program disposal reentered.');
      }
      if (disposed) return;
      disposed = true;
      if (signal) remove.call(signal, 'abort', abortSource);
      abort.call(controller, Error('Selected FFmpeg program disposed.'));
    },
  };
  const program: FFmpegExecutable = Object.freeze({
    metadata() {
      const original = owners.get(this);
      if (!original) throw Error('An original selected FFmpeg program is required.');
      return original.metadata();
    },
    dispose() {
      const original = owners.get(this);
      if (!original) throw Error('An original selected FFmpeg program is required.');
      original.dispose();
    },
  });
  verify(false, false);
  if (signal) add.call(signal, 'abort', abortSource, { once: true });
  owners.set(program, owner);
  return program;
}
/** Exact capability plus exact originally selected path; public hashes never own
 * approval. Cheap checks include identity/stamps; full checks also hash bytes. */
export function verifyFFmpegExecutable(program: object, expectedPath: string, full = false) {
  const owner = owners.get(program);
  if (!owner) throw Error('An original selected FFmpeg program is required.');
  if (typeof full !== 'boolean' || expectedPath !== owner.path)
    throw Error('The original selected FFmpeg program path is required.');
  owner.verify(full);
}
/** Cancellation provenance only; obtaining a signal never approves file bytes.
 * Execution still requires original-path full admission before spawning. */
export function ffmpegExecutableSignal(program: object) {
  const owner = owners.get(program);
  if (!owner) throw Error('An original selected FFmpeg program is required.');
  return owner.signal();
}
