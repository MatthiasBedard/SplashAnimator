import {
  promises as fs,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  type BigIntStats,
} from 'node:fs';
import { resolve, parse, join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareFFmpegProcess, type FFmpegProcessSettings } from './ffmpeg-process';
import { inspectFFmpegPNG, inspectFFmpegWAV } from './ffmpeg-stage-bytes';
export interface FFmpegStageInputs {
  frames: readonly Uint8Array[];
  audio?: Uint8Array;
}
export interface FFmpegStageLocation {
  root: string;
  executable: string;
}
export interface FFmpegStageOptions {
  validate: () => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}
export interface FFmpegStage {
  metadata(): {
    directory: string;
    executable: string;
    byteLength: number;
    settings: FFmpegProcessSettings;
    files: { name: string; size: number; sha256: string }[];
  };
  dispose(): Promise<void>;
}
/** Internal coordinator access. Exact receivers retain the original stage;
 * validate is cheap source/path admission, verify also hashes every input. */
export interface FFmpegStageLease {
  readonly signal: AbortSignal;
  metadata(): ReturnType<FFmpegStage['metadata']>;
  validate(): void;
  verify(): void;
}
type FileRecord = {
  name: string;
  bytes: Uint8Array;
  hash: string;
  identity?: BigIntStats;
  complete: boolean;
};
type Owner = {
  metadata: FFmpegStage['metadata'];
  verify: () => void;
  dispose: () => Promise<void>;
  lease<T>(run: (lease: FFmpegStageLease) => Promise<T>, admit: () => void): Promise<T>;
};
const owners = new WeakMap<object, Owner>(),
  maximum = 512 * 1024 * 1024,
  Bytes = Uint8Array,
  typed = Object.getPrototypeOf(Bytes.prototype),
  length = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!,
  buffer = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!,
  offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!,
  set = Bytes.prototype.set;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const identity = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
function noLinks(path: string) {
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw Error('FFmpeg staging paths cannot contain links.');
  }
}
function snapshotBytes(value: Uint8Array, limit: number) {
  if (!(value instanceof Bytes)) throw Error('FFmpeg staging requires original byte arrays.');
  const n = length.call(value) as number,
    storage = buffer.call(value) as ArrayBuffer;
  if (!(storage instanceof ArrayBuffer) || !Number.isSafeInteger(n) || n < 1 || n > limit)
    throw Error('FFmpeg staged input exceeds its unshared byte budget.');
  const result = new Bytes(n);
  set.call(result, new Bytes(storage, offset.call(value), n));
  return result;
}
let capturing = false,
  captureReentered = false;
export function verifyFFmpegStage(stage: object) {
  const owner = owners.get(stage);
  if (!owner) throw Error('An original FFmpeg stage is required.');
  owner.verify();
}
/** Keeps the original input directory alive until the awaited operation settles.
 * Disposal aborts its lease and waits; callers must await actual child close. */
export async function withFFmpegStage<T>(
  stage: object,
  run: (lease: FFmpegStageLease) => Promise<T>,
  admit: () => void = () => {},
): Promise<T> {
  const owner = owners.get(stage);
  if (!owner) throw Error('An original FFmpeg stage is required.');
  if (typeof run !== 'function' || typeof admit !== 'function')
    throw Error('An original FFmpeg stage operation is required.');
  return owner.lease(run, admit);
}
/** Exclusive, private input staging only. Caller authorizes the root/executable;
 * no manifest extraction, process, recursive deletion, endpoint or destination.
 * Filesystem checks detect ordinary replacement/modification at admission points,
 * not an OS-level sandbox against concurrent privileged filesystem attackers.
 */
export async function createFFmpegStage(
  settings: FFmpegProcessSettings,
  inputs: FFmpegStageInputs,
  location: FFmpegStageLocation,
  options: FFmpegStageOptions,
): Promise<FFmpegStage> {
  if (capturing) {
    captureReentered = true;
    throw Error('FFmpeg staging capture reentered.');
  }
  capturing = true;
  captureReentered = false;
  const started = performance.now();
  let checking = false,
    reentered = false;
  let validate: () => void,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    maxBytes: number,
    root: string,
    executable: string,
    spec: FFmpegProcessSettings,
    byteCount = 0;
  const records: FileRecord[] = [];
  const check = () => {
    signal?.throwIfAborted();
    if (performance.now() - started >= timeoutMs) throw Error('FFmpeg staging timed out.');
    if (checking) {
      reentered = true;
      throw Error('FFmpeg staging admission reentered.');
    }
    checking = true;
    try {
      const result = validate() as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('FFmpeg staging validation must be synchronous.');
      }
      if (reentered || (capturing && captureReentered))
        throw Error('FFmpeg staging admission reentered.');
      signal?.throwIfAborted();
      if (performance.now() - started >= timeoutMs) throw Error('FFmpeg staging timed out.');
    } finally {
      checking = false;
    }
  };
  // Snapshot every input/settings/callback/native dependency before the first await.
  const io = {
    realpath: fs.realpath,
    lstat: fs.lstat,
    mkdtemp: fs.mkdtemp,
    open: fs.open,
    unlink: fs.unlink,
    rmdir: fs.rmdir,
  };
  try {
    if (
      !options ||
      Reflect.ownKeys(options).some(
        (key) => !['validate', 'signal', 'timeoutMs', 'maxBytes'].includes(key as string),
      )
    )
      throw Error('Unexpected FFmpeg staging option fields.');
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
      throw Error('Invalid FFmpeg staging options.');
    if (
      !location ||
      Reflect.ownKeys(location).some((k) => k !== 'root' && k !== 'executable') ||
      !inputs ||
      Reflect.ownKeys(inputs).some((k) => k !== 'frames' && k !== 'audio')
    )
      throw Error('Unexpected FFmpeg staging input fields.');
    ({ root, executable } = location);
    const probe = prepareFFmpegProcess(settings, { directory: root, executable }, check),
      view = probe.metadata();
    probe.dispose();
    spec = {
      width: view.width,
      height: view.height,
      firstNumber: view.firstNumber,
      frameCount: view.frameCount,
      rate: view.rate,
      scale: view.scale,
      audio: view.audio,
    };
    root = resolve(root);
    const { frames, audio } = inputs;
    if (
      !Array.isArray(frames) ||
      frames.length !== spec.frameCount ||
      spec.audio !== (audio !== undefined)
    )
      throw Error('Incomplete FFmpeg frame/audio input set.');
    for (let i = 0; i < spec.frameCount; i++) {
      check();
      if (!Object.hasOwn(frames, i)) throw Error('FFmpeg source frame is missing.');
      const bytes = snapshotBytes(frames[i], maxBytes - byteCount);
      inspectFFmpegPNG(bytes, spec.width, spec.height);
      byteCount += bytes.length;
      records.push({
        name: `frame-${String(spec.firstNumber + i).padStart(6, '0')}.png`,
        bytes,
        hash: hash(bytes),
        complete: false,
      });
      check();
    }
    if (frames.length !== spec.frameCount) throw Error('FFmpeg source frame count changed.');
    if (audio !== undefined) {
      const bytes = snapshotBytes(audio, maxBytes - byteCount);
      inspectFFmpegWAV(bytes, spec);
      byteCount += bytes.length;
      records.push({ name: 'audio.wav', bytes, hash: hash(bytes), complete: false });
      check();
    }
    check();
  } finally {
    capturing = false;
  }
  let directory: string | undefined,
    rootReal: string | undefined,
    rootIdentity: BigIntStats | undefined,
    stageIdentity: BigIntStats | undefined;
  let reading = false,
    state: 'preparing' | 'sealed' | 'disposing' | 'disposed' = 'preparing',
    disposal: Promise<void> | undefined;
  let leased = false,
    leaseController: AbortController | undefined,
    leaseFinished: Promise<void> | undefined;
  const rootGuard = () => {
    if (!rootReal || !rootIdentity) throw Error('FFmpeg staging root is not owned.');
    noLinks(root);
    const now = lstatSync(root, { bigint: true });
    if (!now.isDirectory() || !identity(now, rootIdentity) || realpathSync(root) !== rootReal)
      throw Error('FFmpeg staging root changed.');
  };
  const directoryGuard = () => {
    rootGuard();
    if (
      !directory ||
      !stageIdentity ||
      dirname(directory) !== rootReal ||
      !basename(directory).startsWith('splash-ffmpeg-')
    )
      throw Error('FFmpeg private directory is not owned.');
    noLinks(directory);
    const current = lstatSync(directory, { bigint: true });
    if (
      !current.isDirectory() ||
      !identity(current, stageIdentity) ||
      realpathSync(directory) !== directory
    )
      throw Error('FFmpeg private directory changed.');
  };
  const fileBytes = (record: FileRecord, allowPartial = false) => {
    const path = join(directory!, record.name),
      current = lstatSync(path, { bigint: true });
    if (
      !record.identity ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1n ||
      !identity(current, record.identity) ||
      realpathSync(path) !== path
    )
      throw Error('FFmpeg staged file identity changed.');
    if (current.size > BigInt(record.bytes.length)) throw Error('FFmpeg staged file size changed.');
    const bytes = readFileSync(path);
    if (allowPartial && !record.complete) {
      if (bytes.some((b, i) => b !== record.bytes[i]))
        throw Error('FFmpeg partial staged bytes changed.');
    } else if (bytes.length !== record.bytes.length || hash(bytes) !== record.hash)
      throw Error('FFmpeg staged file content changed.');
    return bytes;
  };
  const verify = () => {
    if (state !== 'sealed') throw Error('FFmpeg stage is not available.');
    if (reading) {
      reentered = true;
      throw Error('FFmpeg stage verification reentered.');
    }
    reading = true;
    reentered = false;
    try {
      check();
      directoryGuard();
      const names = readdirSync(directory!),
        expectedNames = new Set(records.map((record) => record.name));
      if (names.length !== records.length || names.some((name) => !expectedNames.has(name)))
        throw Error('FFmpeg staging entries changed.');
      for (const record of records) {
        fileBytes(record);
        check();
      }
      directoryGuard();
      check();
    } finally {
      reading = false;
    }
  };
  const cleanup = async () => {
    if (!directory) return;
    directoryGuard();
    const names = new Set(readdirSync(directory)),
      allowed = new Set(records.map((r) => r.name));
    if ([...names].some((name) => !allowed.has(name)))
      throw Error('FFmpeg staging contains unowned entries; cleanup refused.');
    // Admission of all remaining files precedes the first unlink. No recursive delete.
    for (const record of records) if (names.has(record.name)) fileBytes(record, true);
    for (const record of [...records].reverse())
      if (names.has(record.name)) {
        directoryGuard();
        fileBytes(record, true);
        await io.unlink(join(directory, record.name));
        directoryGuard();
      }
    directoryGuard();
    await io.rmdir(directory);
    directory = undefined;
  };
  try {
    check();
    noLinks(root);
    rootReal = realpathSync(root);
    rootIdentity = lstatSync(root, { bigint: true });
    const originalReal = await io.realpath(root),
      originalStat = await io.lstat(root, { bigint: true });
    if (originalReal !== rootReal || !identity(originalStat, rootIdentity))
      throw Error('FFmpeg staging root changed during preparation.');
    rootGuard();
    check();
    const created = await io.mkdtemp(join(rootReal, 'splash-ffmpeg-'));
    directory = resolve(created);
    if (dirname(directory) !== rootReal)
      throw Error('FFmpeg created directory escaped the authorized root.');
    stageIdentity = lstatSync(directory, { bigint: true });
    directoryGuard();
    check();
    for (const record of records) {
      directoryGuard();
      check();
      const handle = await io.open(join(directory, record.name), 'wx', 0o600);
      const write = handle.writeFile,
        sync = handle.sync,
        close = handle.close,
        stat = handle.stat;
      try {
        record.identity = (await stat.call(handle, { bigint: true })) as BigIntStats;
        directoryGuard();
        check();
        await write.call(handle, record.bytes);
        record.complete = true;
        check();
        await sync.call(handle);
        directoryGuard();
        fileBytes(record);
        check();
      } finally {
        await close.call(handle);
      }
    }
    state = 'sealed';
    verify();
    const owner: Owner = {
      verify,
      metadata() {
        verify();
        reading = true;
        reentered = false;
        try {
          const result = {
            directory: directory!,
            executable,
            byteLength: byteCount,
            settings: { ...spec },
            files: records.map((r) => ({ name: r.name, size: r.bytes.length, sha256: r.hash })),
          };
          check();
          return result;
        } finally {
          reading = false;
        }
      },
      dispose() {
        if (state === 'disposed') return Promise.resolve();
        if (disposal) return disposal;
        if (reading || checking) {
          reentered = true;
          return Promise.reject(Error('FFmpeg stage disposal reentered.'));
        }
        state = 'disposing';
        // Even cancellation/failed termination cannot delete files while a child
        // still owns them. The coordinator's operation awaits actual close.
        disposal = (leased ? leaseFinished! : Promise.resolve()).then(cleanup).then(
          () => {
            state = 'disposed';
            for (const record of records) record.bytes = new Bytes(0);
          },
          (error) => {
            state = 'sealed';
            disposal = undefined;
            throw error;
          },
        );
        leaseController?.abort(Error('FFmpeg stage disposal requested.'));
        return disposal;
      },
      async lease<T>(run: (lease: FFmpegStageLease) => Promise<T>, admit: () => void): Promise<T> {
        if (reading || checking) {
          reentered = true;
          throw Error('FFmpeg stage lease reentered.');
        }
        if (state !== 'sealed' || leased)
          throw Error('FFmpeg stage is unavailable or already leased.');
        const controller = new AbortController();
        leased = true;
        let active = true;
        leaseController = controller;
        let release!: () => void;
        leaseFinished = new Promise<void>((resolve) => {
          release = resolve;
        });
        const validate = () => {
          controller.signal.throwIfAborted();
          if (state !== 'sealed' || !leased || !active)
            throw Error('FFmpeg stage lease is no longer active.');
          directoryGuard();
          check();
          controller.signal.throwIfAborted();
          if (state !== 'sealed' || !leased || !active) throw Error('FFmpeg stage lease changed.');
        };
        let outcome: { value: T } | { error: unknown };
        try {
          const lease: FFmpegStageLease = Object.freeze({
            signal: controller.signal,
            metadata() {
              if (this !== lease) throw Error('An original FFmpeg stage lease is required.');
              validate();
              return owner.metadata();
            },
            validate() {
              if (this !== lease) throw Error('An original FFmpeg stage lease is required.');
              validate();
            },
            verify() {
              if (this !== lease) throw Error('An original FFmpeg stage lease is required.');
              validate();
              verify();
            },
          });
          const value = await run(lease);
          validate();
          const admitted = admit() as unknown;
          if (admitted && typeof (admitted as { then?: unknown }).then === 'function') {
            void Promise.resolve(admitted).catch(() => {});
            throw Error('FFmpeg stage final admission must be synchronous.');
          }
          validate();
          outcome = { value };
        } catch (error) {
          outcome = { error };
        } finally {
          active = false;
          leased = false;
          leaseController = undefined;
          leaseFinished = undefined;
          release();
        }
        if (disposal) {
          try {
            await disposal;
          } catch (error) {
            if ('error' in outcome)
              throw new AggregateError(
                [outcome.error, error],
                'FFmpeg stage operation and requested cleanup failed.',
              );
            throw error;
          }
        }
        if ('error' in outcome) throw outcome.error;
        return outcome.value;
      },
    };
    const stage: FFmpegStage = Object.freeze({
      metadata() {
        const original = owners.get(this);
        if (!original) throw Error('An original FFmpeg stage is required.');
        return original.metadata();
      },
      dispose() {
        const original = owners.get(this);
        if (!original) return Promise.reject(Error('An original FFmpeg stage is required.'));
        return original.dispose();
      },
    });
    check();
    owners.set(stage, owner);
    return stage;
  } catch (error) {
    try {
      await cleanup();
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'FFmpeg staging failed and owned cleanup was refused or failed.',
      );
    }
    throw error;
  }
}
