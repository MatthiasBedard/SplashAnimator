import fsNative, { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter, getEventListeners } from 'node:events';
import { resolve, join, dirname, basename } from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  createFFmpegStage,
  withFFmpegStage,
  type FFmpegStageLease,
} from '../packages/export-video/src/ffmpeg-stage';
import {
  runStagedFFmpeg,
  type FFmpegStagedProcessOptions,
} from '../packages/export-video/src/ffmpeg-staged-process';
import type { FFmpegSpawn } from '../packages/export-video/src/ffmpeg-process';
import { png } from './ffmpeg-stage-fixture';
import { pcm16WavFixture } from './wav-fixture';
import {
  prepareFFmpegExecutable,
  ffmpegExecutableSignal,
} from '../packages/export-video/src/ffmpeg-executable';
const settings = {
  width: 2,
  height: 2,
  firstNumber: 2,
  frameCount: 3,
  rate: 30000,
  scale: 1001,
  audio: false,
};
const payload = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x18, 0x53, 0x80, 0x67]);
let base: string, root: string, executable: string;
class Child extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kills: string[] = [];
  killError = false;
  autoClose = false;
  kill(signal: string) {
    this.kills.push(signal);
    if (this.killError) throw Error('kill failed');
    if (this.autoClose) queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
    return true;
  }
  complete() {
    this.stdout.emit('data', payload());
    this.emit('exit', 0, null);
    this.emit('close', 0, null);
  }
}
beforeEach(async () => {
  base = await fs.mkdtemp(join(process.cwd(), '.verification-staged-process-'));
  root = join(base, 'allowed');
  executable = join(base, 'selected ffmpeg.exe');
  await fs.mkdir(root);
  await fs.writeFile(join(root, 'keep.txt'), 'user artwork');
});
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.useRealTimers();
  const target = resolve(base);
  if (
    dirname(target) !== resolve(process.cwd()) ||
    !basename(target).startsWith('.verification-staged-process-')
  )
    throw Error('Unsafe fixture cleanup');
  await fs.rm(target, { recursive: true, force: true });
});
async function fixture(validate: () => void = () => {}, audio = false) {
  const stage = await createFFmpegStage(
    { ...settings, audio },
    {
      frames: [png(), png(), png()],
      ...(audio ? { audio: pcm16WavFixture([Array(4804).fill(123)], 48000) } : {}),
    },
    { root, executable },
    { validate },
  );
  const info = stage.metadata(),
    children: Child[] = [];
  const spawn = vi.fn((..._args: Parameters<FFmpegSpawn>) => {
    const child = new Child();
    children.push(child);
    return child as never;
  });
  const authority = vi.fn((path: string) => {
    if (path !== executable) throw Error('wrong original executable');
  });
  return { stage, info, spawn, children, options: { validateExecutable: authority }, authority };
}
async function empty() {
  expect(await fs.readdir(root)).toEqual(['keep.txt']);
  expect(await fs.readFile(join(root, 'keep.txt'), 'utf8')).toBe('user artwork');
}
async function stillOwned(dir: string) {
  expect(await fs.readdir(dir)).toEqual([
    'frame-000002.png',
    'frame-000003.png',
    'frame-000004.png',
  ]);
}
async function programFixture(validate: () => void = () => {}) {
  const f = await fixture(),
    bytes = Uint8Array.from({ length: 65553 }, (_, i) => (i * 7) % 256);
  await fs.writeFile(executable, bytes);
  const program = await prepareFFmpegExecutable(executable, { validate });
  return { ...f, bytes, program };
}
it('runs only original staged settings/program/paths and returns exact detached pipe bytes after close', async () => {
  const f = await fixture(),
    job = runStagedFFmpeg(f.stage, f.options, f.spawn),
    child = f.children[0];
  const raw = payload();
  child.stdout.emit('data', raw);
  raw.fill(0);
  child.stderr.emit('data', Buffer.from('diagnostic'));
  child.emit('exit', 0, null);
  let settled = false;
  void job.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  await stillOwned(f.info.directory);
  child.emit('close', 0, null);
  const out = await job;
  expect(out).toMatchObject({
    bytes: payload(),
    byteLength: 8,
    requested: settings,
    diagnostics: 'diagnostic',
  });
  expect(Object.isFrozen(out)).toBe(true);
  const [program, args, options] = f.spawn.mock.calls[0];
  expect(program).toBe(executable);
  expect(options).toMatchObject({
    cwd: f.info.directory,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(args).toContain('frame-%06d.png');
  expect(args.slice(args.indexOf('-framerate'), args.indexOf('-framerate') + 2)).toEqual([
    '-framerate',
    '30000/1001',
  ]);
  expect(args.slice(args.indexOf('-start_number'), args.indexOf('-start_number') + 2)).toEqual([
    '-start_number',
    '2',
  ]);
  expect(f.authority).toHaveBeenCalledWith(executable);
  await stillOwned(f.info.directory);
  await f.stage.dispose();
  await empty();
});
it('captures options and selected-program authority before original source callbacks can replace them', async () => {
  let armed = false,
    hook = () => {};
  const f = await fixture(() => {
    if (armed) hook();
  });
  let reads = 0;
  const options = {
    get validateExecutable(): FFmpegStagedProcessOptions['validateExecutable'] {
      reads++;
      return f.authority;
    },
    maxBytes: 8,
    timeoutMs: 60000,
  };
  hook = () => {
    options.maxBytes = 1;
    options.timeoutMs = NaN;
    Object.defineProperty(options, 'validateExecutable', {
      value: () => {
        throw Error('replacement');
      },
      configurable: true,
    });
  };
  armed = true;
  const pending = runStagedFFmpeg(f.stage, options, f.spawn);
  f.children[0].complete();
  expect((await pending).byteLength).toBe(8);
  expect(reads).toBe(1);
  armed = false;
  await f.stage.dispose();
});
it('rehashes inputs at bounded boundaries, not once per encoded chunk', async () => {
  const f = await fixture(),
    read = fsNative.readFileSync;
  let hashes = 0;
  vi.spyOn(fsNative, 'readFileSync').mockImplementation(((
    ...args: Parameters<typeof fsNative.readFileSync>
  ) => {
    if (String(args[0]).startsWith(f.info.directory) && String(args[0]).endsWith('.png')) hashes++;
    return read(...args);
  }) as typeof fsNative.readFileSync);
  syncBuiltinESMExports();
  f.stage.metadata();
  expect(hashes).toBe(3);
  hashes = 0;
  const pending = runStagedFFmpeg(f.stage, f.options, f.spawn),
    child = f.children[0];
  child.stdout.emit('data', payload());
  for (let i = 0; i < 100; i++) child.stdout.emit('data', new Uint8Array([0]));
  expect(hashes).toBe(3);
  child.emit('close', 0, null);
  expect((await pending).byteLength).toBe(108);
  expect(hashes).toBe(6);
  await f.stage.dispose();
});
for (const phase of ['running', 'after exit', 'during spawn'] as const)
  it(`waits for actual close before requested disposal ${phase}`, async () => {
    const f = await fixture();
    let disposal: Promise<void> | undefined;
    const spawn: FFmpegSpawn = (...args) => {
      const child = f.spawn(...args);
      if (phase === 'during spawn') disposal = f.stage.dispose();
      return child;
    };
    const pending = runStagedFFmpeg(f.stage, f.options, spawn),
      assertion = expect(pending).rejects.toThrow(/disposal|disposed/),
      child = f.children[0];
    if (phase === 'after exit') child.emit('exit', 0, null);
    disposal ??= f.stage.dispose();
    expect(f.stage.dispose()).toBe(disposal);
    let disposed = false;
    void disposal.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    await stillOwned(f.info.directory);
    expect(child.kills).toEqual(['SIGKILL']);
    child.emit('close', null, 'SIGKILL');
    await assertion;
    await disposal;
    await empty();
  });
for (const mode of [
  'caller cancel',
  'timeout',
  'source',
  'program authority',
  'kill failure',
] as const)
  it(`retains leased inputs through ${mode} until actual close and supports a safe fresh operation`, async () => {
    let valid = true;
    const f = await fixture(() => {
        if (!valid) throw Error('source changed');
      }),
      controller = new AbortController();
    let program = true;
    const options: FFmpegStagedProcessOptions = {
      validateExecutable: () => {
        if (!program) throw Error('program changed');
      },
      signal: controller.signal,
    };
    if (mode === 'timeout') {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      options.timeoutMs = 20;
    }
    const pending = runStagedFFmpeg(f.stage, options, f.spawn),
      assertion = expect(pending).rejects.toThrow(),
      child = f.children[0];
    if (mode === 'kill failure') child.killError = true;
    if (mode === 'caller cancel' || mode === 'kill failure')
      controller.abort(Error('caller cancelled'));
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(21);
    if (mode === 'source') {
      valid = false;
      child.stderr.emit('data', Buffer.from('x'));
    }
    if (mode === 'program authority') {
      program = false;
      child.stderr.emit('data', Buffer.from('x'));
    }
    expect(child.kills).toEqual(['SIGKILL']);
    await stillOwned(f.info.directory);
    child.emit('exit', null, 'SIGKILL');
    await stillOwned(f.info.directory);
    child.emit('close', null, 'SIGKILL');
    await assertion;
    vi.useRealTimers();
    valid = true;
    program = true;
    const retry = runStagedFFmpeg(f.stage, f.options, f.spawn);
    f.children[1].complete();
    expect((await retry).bytes).toEqual(payload());
    await f.stage.dispose();
    await empty();
  });
it('combines failed termination and refused requested cleanup, preserving all foreign data', async () => {
  const f = await fixture(),
    pending = runStagedFFmpeg(f.stage, f.options, f.spawn),
    child = f.children[0];
  child.killError = true;
  await fs.writeFile(join(f.info.directory, 'foreign-art.png'), 'preserve');
  const captured = pending.catch((error) => error);
  const runAssertion = expect(pending).rejects.toThrow(/operation and requested cleanup failed/),
    disposal = f.stage.dispose(),
    disposeAssertion = expect(disposal).rejects.toThrow(/unowned entries/);
  expect(await fs.readdir(f.info.directory)).toHaveLength(4);
  expect(child.kills).toHaveLength(1);
  child.emit('close', null, 'SIGKILL');
  await runAssertion;
  await disposeAssertion;
  const failure = await captured;
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors[0]).toBeInstanceOf(AggregateError);
  expect(failure.errors[0].errors[1].message).toBe('kill failed');
  expect(failure.errors[1].message).toContain('unowned entries');
  expect(await fs.readFile(join(f.info.directory, 'foreign-art.png'), 'utf8')).toBe('preserve');
  expect(await fs.readdir(f.info.directory)).toHaveLength(4);
  await fs.unlink(join(f.info.directory, 'foreign-art.png'));
  await f.stage.dispose();
  await empty();
});
it('rejects late changed input bytes at completion, retains changed data, and allows restored retry', async () => {
  const f = await fixture(),
    file = join(f.info.directory, 'frame-000003.png'),
    original = await fs.readFile(file);
  const pending = runStagedFFmpeg(f.stage, f.options, f.spawn),
    assertion = expect(pending).rejects.toThrow(/content changed/),
    child = f.children[0];
  await fs.writeFile(file, new Uint8Array(original.length).fill(7));
  child.stderr.emit('data', Buffer.from('ordinary chunk'));
  expect(child.kills).toHaveLength(0);
  child.complete();
  await assertion;
  await expect(f.stage.dispose()).rejects.toThrow(/content changed/);
  expect(new Uint8Array(await fs.readFile(file))).toEqual(new Uint8Array(original.length).fill(7));
  await fs.writeFile(file, original);
  const retry = runStagedFFmpeg(f.stage, f.options, f.spawn);
  f.children[1].complete();
  await retry;
  await f.stage.dispose();
});
it('rejects directory replacement during the child lifetime and never removes the foreign replacement', async () => {
  const f = await fixture(),
    backup = join(base, 'original-stage'),
    pending = runStagedFFmpeg(f.stage, f.options, f.spawn),
    assertion = expect(pending).rejects.toThrow(/directory changed/),
    child = f.children[0];
  await fs.rename(f.info.directory, backup);
  await fs.mkdir(f.info.directory);
  await fs.writeFile(join(f.info.directory, 'foreign.txt'), 'keep');
  child.stderr.emit('data', Buffer.from('x'));
  expect(child.kills).toHaveLength(1);
  child.emit('close', null, 'SIGKILL');
  await assertion;
  await expect(f.stage.dispose()).rejects.toThrow(/directory changed/);
  expect(await fs.readFile(join(f.info.directory, 'foreign.txt'), 'utf8')).toBe('keep');
  await fs.unlink(join(f.info.directory, 'foreign.txt'));
  await fs.rmdir(f.info.directory);
  await fs.rename(backup, f.info.directory);
  await f.stage.dispose();
});
for (const [key, value] of [
  ['timeoutMs', 0],
  ['timeoutMs', 60001],
  ['timeoutMs', NaN],
  ['maxBytes', 0],
  ['maxBytes', 512 * 1024 * 1024 + 1],
  ['maxDiagnostics', 0],
  ['maxDiagnostics', 1024 * 1024 + 1],
  ['signal', {}],
  ['validateExecutable', null],
  ['shell', true],
  ['suggestedArguments', ['unsafe']],
] as const)
  it(`rejects malformed coordinator ${key} without spawning or consuming the valid stage`, async () => {
    const f = await fixture();
    Object.assign(f.options, { [key]: value });
    await expect(runStagedFFmpeg(f.stage, f.options, f.spawn)).rejects.toThrow();
    expect(f.spawn).not.toHaveBeenCalled();
    f.stage.metadata();
    await f.stage.dispose();
  });
it('rejects forged/public/proxied stages before reading options or invoking authority', async () => {
  const f = await fixture(),
    options = {
      get validateExecutable(): FFmpegStagedProcessOptions['validateExecutable'] {
        throw Error('must not read');
      },
    };
  for (const stage of [{ ...f.stage }, f.stage.metadata(), new Proxy(f.stage, {}), {}])
    await expect(runStagedFFmpeg(stage, options, f.spawn)).rejects.toThrow(/original FFmpeg stage/);
  expect(f.spawn).not.toHaveBeenCalled();
  await f.stage.dispose();
});
it('rejects async/failed authority and already-cancelled input before spawn, with source-valid retries', async () => {
  const f = await fixture();
  for (const validateExecutable of [
    async () => {},
    () => {
      throw Error('not approved');
    },
  ])
    await expect(runStagedFFmpeg(f.stage, { validateExecutable }, f.spawn)).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    runStagedFFmpeg(f.stage, { ...f.options, signal: controller.signal }, f.spawn),
  ).rejects.toThrow();
  expect(f.spawn).not.toHaveBeenCalled();
  const pending = runStagedFFmpeg(f.stage, f.options, f.spawn);
  f.children[0].complete();
  await pending;
  await f.stage.dispose();
});
it('rejects a concurrent operation without reading its options or invalidating the original child', async () => {
  const f = await fixture(),
    pending = runStagedFFmpeg(f.stage, f.options, f.spawn);
  await expect(
    runStagedFFmpeg(
      f.stage,
      {
        get validateExecutable(): FFmpegStagedProcessOptions['validateExecutable'] {
          throw Error('must not read');
        },
      },
      f.spawn,
    ),
  ).rejects.toThrow(/already leased/);
  f.children[0].complete();
  await pending;
  expect(f.children).toHaveLength(1);
  await f.stage.dispose();
});
it('releases a stage after spawn throws and after a real missing-program close', async () => {
  const f = await fixture(),
    spawn = vi.fn(() => {
      throw Error('spawn failed');
    });
  await expect(runStagedFFmpeg(f.stage, f.options, spawn)).rejects.toThrow(/spawn failed/);
  f.stage.metadata();
  await expect(runStagedFFmpeg(f.stage, f.options)).rejects.toThrow(/ENOENT/);
  f.stage.metadata();
  await f.stage.dispose();
});
it('invalidates completed lease receivers permanently even when another lease starts', async () => {
  const f = await fixture();
  let old!: FFmpegStageLease;
  await withFFmpegStage(f.stage, async (lease) => {
    old = lease;
    const copy = { ...lease },
      method = lease.metadata;
    expect(() => copy.metadata()).toThrow(/original/);
    expect(() => method()).toThrow(/original/);
    expect(() => new Proxy(lease, {}).verify()).toThrow(/original/);
    lease.verify();
  });
  expect(() => old.validate()).toThrow(/active/);
  await withFFmpegStage(f.stage, async (lease) => {
    expect(() => old.metadata()).toThrow(/active/);
    lease.metadata();
  });
  await f.stage.dispose();
});
it('rejects late final-admission source/program changes after the process result has settled', async () => {
  let armed = false,
    program = true;
  const f = await fixture(() => {
    if (armed)
      queueMicrotask(() => {
        program = false;
      });
  });
  const options = {
      validateExecutable: () => {
        if (!program) throw Error('late program');
      },
    },
    pending = runStagedFFmpeg(f.stage, options, f.spawn),
    assertion = expect(pending).rejects.toThrow(/late program/);
  armed = true;
  f.children[0].complete();
  await assertion;
  armed = false;
  program = true;
  f.stage.metadata();
  await f.stage.dispose();
});
it('rejects an asynchronous final lease gate without disposing valid inputs', async () => {
  const f = await fixture();
  await expect(
    withFFmpegStage(
      f.stage,
      async (lease) => {
        lease.verify();
        return 1;
      },
      async () => {},
    ),
  ).rejects.toThrow(/synchronous/);
  f.stage.metadata();
  await f.stage.dispose();
});
it('retains original optional PCM mapping and fixed rational/audio settings', async () => {
  const f = await fixture(() => {}, true),
    pending = runStagedFFmpeg(f.stage, f.options, f.spawn);
  f.children[0].complete();
  expect((await pending).requested).toEqual({ ...settings, audio: true });
  const args = f.spawn.mock.calls[0][1];
  expect(args).toContain('audio.wav');
  expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2)).toEqual(['-c:a', 'pcm_s16le']);
  expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0');
  await f.stage.dispose();
  await empty();
});
for (const mode of ['bytes', 'diagnostics'] as const)
  it(`forwards exact ${mode} limits while keeping inputs through failure close`, async () => {
    const f = await fixture(),
      options = { ...f.options, ...(mode === 'bytes' ? { maxBytes: 7 } : { maxDiagnostics: 1 }) },
      pending = runStagedFFmpeg(f.stage, options, f.spawn),
      assertion = expect(pending).rejects.toThrow(/budget/),
      child = f.children[0];
    if (mode === 'bytes') child.stdout.emit('data', payload());
    else child.stderr.emit('data', new Uint8Array([1, 2]));
    expect(child.kills).toHaveLength(1);
    await stillOwned(f.info.directory);
    child.emit('close', null, 'SIGKILL');
    await assertion;
    f.stage.metadata();
    await f.stage.dispose();
  });
it('captures native caller-signal methods/reason and removes listeners after a cancelled close', async () => {
  const f = await fixture(),
    controller = new AbortController(),
    signal = controller.signal;
  for (const name of ['addEventListener', 'removeEventListener', 'throwIfAborted', 'reason'])
    Object.defineProperty(signal, name, {
      get() {
        throw Error('public signal override');
      },
    });
  const pending = runStagedFFmpeg(f.stage, { ...f.options, signal }, f.spawn),
    assertion = expect(pending).rejects.toThrow(/original cancel reason/),
    child = f.children[0];
  expect(getEventListeners(signal, 'abort')).toHaveLength(1);
  controller.abort(Error('original cancel reason'));
  await stillOwned(f.info.directory);
  child.emit('close', null, 'SIGKILL');
  await assertion;
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  await f.stage.dispose();
});
it('includes input verification time in the overall deadline before spawning', async () => {
  let armed = false,
    time = 0;
  const f = await fixture(() => {
    if (armed) time = 21;
  });
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  armed = true;
  await expect(runStagedFFmpeg(f.stage, { ...f.options, timeoutMs: 20 }, f.spawn)).rejects.toThrow(
    /timed out/,
  );
  expect(f.spawn).not.toHaveBeenCalled();
  armed = false;
  vi.restoreAllMocks();
  await f.stage.dispose();
});
it('waits for lease release when an option getter requests disposal before any child exists', async () => {
  const f = await fixture();
  let disposal: Promise<void> | undefined;
  const pending = runStagedFFmpeg(
    f.stage,
    {
      get validateExecutable(): FFmpegStagedProcessOptions['validateExecutable'] {
        disposal = f.stage.dispose();
        return f.authority;
      },
    },
    f.spawn,
  );
  await expect(pending).rejects.toThrow(/disposal/);
  await disposal;
  expect(f.spawn).not.toHaveBeenCalled();
  await empty();
});
it('rejects disposal after a complete native receipt exists, and cleans only after the closed lease settles', async () => {
  const f = await fixture(),
    freeze = Object.freeze;
  let disposal: Promise<void> | undefined,
    hits = 0;
  const pending = runStagedFFmpeg(f.stage, f.options, f.spawn),
    assertion = expect(pending).rejects.toThrow(/disposal/);
  vi.spyOn(Object, 'freeze').mockImplementation((value) => {
    const out = freeze(value);
    if (
      out &&
      typeof out === 'object' &&
      Object.hasOwn(out, 'bytes') &&
      Object.hasOwn(out, 'requested')
    ) {
      hits++;
      disposal = f.stage.dispose();
    }
    return out;
  });
  f.children[0].complete();
  await assertion;
  await disposal;
  expect(hits).toBe(1);
  await empty();
});
it('explicitly qualifies an original selected program with two full hash phases over100chunks', async () => {
  const read = fsNative.readSync,
    open = fsNative.openSync,
    paths = new Map<number, string>();
  let count = 0;
  vi.spyOn(fsNative, 'openSync').mockImplementation(((
    ...args: Parameters<typeof fsNative.openSync>
  ) => {
    const fd = open(...args);
    paths.set(fd, String(args[0]));
    return fd;
  }) as typeof fsNative.openSync);
  vi.spyOn(fsNative, 'readSync').mockImplementation(((
    ...args: Parameters<typeof fsNative.readSync>
  ) => {
    const n = read(...args);
    if (paths.get(args[0]) === executable) count += n;
    return n;
  }) as typeof fsNative.readSync);
  const f = await programFixture(),
    signal = ffmpegExecutableSignal(f.program);
  expect(count).toBe(0);
  const pending = runStagedFFmpeg(f.stage, { ...f.options, program: f.program }, f.spawn),
    child = f.children[0];
  expect(count).toBe(f.bytes.length);
  child.stdout.emit('data', payload());
  for (let i = 0; i < 100; i++) child.stdout.emit('data', new Uint8Array([0]));
  expect(count).toBe(f.bytes.length);
  child.emit('close', 0, null);
  expect((await pending).byteLength).toBe(108);
  expect(count).toBe(2 * f.bytes.length);
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  await f.stage.dispose();
  f.program.dispose();
  expect(new Uint8Array(await fs.readFile(executable))).toEqual(f.bytes);
});
it('rejects public/copied/proxied program data without consuming valid staging', async () => {
  const f = await programFixture();
  for (const program of [
    f.program.metadata(),
    { ...f.program },
    new Proxy(f.program, {}),
    {
      get metadata() {
        throw Error('public getter');
      },
    },
  ])
    await expect(runStagedFFmpeg(f.stage, { ...f.options, program }, f.spawn)).rejects.toThrow(
      /original selected/,
    );
  expect(f.spawn).not.toHaveBeenCalled();
  f.stage.metadata();
  f.program.dispose();
  await f.stage.dispose();
});
it('rejects a genuine owner for a different selected path before process execution', async () => {
  const f = await programFixture(),
    other = join(base, 'other.exe');
  await fs.writeFile(other, f.bytes);
  const foreign = await prepareFFmpegExecutable(other, { validate: () => {} });
  await expect(
    runStagedFFmpeg(f.stage, { ...f.options, program: foreign }, f.spawn),
  ).rejects.toThrow(/original.*path/);
  expect(f.spawn).not.toHaveBeenCalled();
  foreign.dispose();
  f.program.dispose();
  await f.stage.dispose();
});
it('aborts disposed program jobs but retains all staged inputs until actual child close', async () => {
  const f = await programFixture(),
    signal = ffmpegExecutableSignal(f.program),
    pending = runStagedFFmpeg(f.stage, { ...f.options, program: f.program }, f.spawn),
    assertion = expect(pending).rejects.toThrow(/program disposed/),
    child = f.children[0];
  f.program.dispose();
  expect(child.kills).toEqual(['SIGKILL']);
  await stillOwned(f.info.directory);
  child.emit('exit', 0, null);
  await stillOwned(f.info.directory);
  const disposal = f.stage.dispose();
  child.emit('close', null, 'SIGKILL');
  await assertion;
  await disposal;
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  await empty();
  expect(new Uint8Array(await fs.readFile(executable))).toEqual(f.bytes);
});
for (const mode of ['source', 'content', 'inode'] as const)
  it(`rejects actual selected-program ${mode} changes during streaming and permits restored original retry`, async () => {
    let valid = true;
    const f = await programFixture(() => {
        if (!valid) throw Error('selected source changed');
      }),
      backup = join(base, 'old-program.exe');
    const pending = runStagedFFmpeg(f.stage, { ...f.options, program: f.program }, f.spawn),
      assertion = expect(pending).rejects.toThrow(),
      child = f.children[0];
    if (mode === 'source') valid = false;
    if (mode === 'content') await fs.writeFile(executable, new Uint8Array(f.bytes.length).fill(8));
    if (mode === 'inode') {
      await fs.rename(executable, backup);
      await fs.writeFile(executable, f.bytes);
    }
    child.stderr.emit('data', new Uint8Array([1]));
    expect(child.kills).toHaveLength(1);
    await stillOwned(f.info.directory);
    child.emit('close', null, 'SIGKILL');
    await assertion;
    valid = true;
    if (mode === 'content') await fs.writeFile(executable, f.bytes);
    if (mode === 'inode') {
      await fs.unlink(executable);
      await fs.rename(backup, executable);
    }
    const retry = runStagedFFmpeg(f.stage, { ...f.options, program: f.program }, f.spawn);
    f.children[1].complete();
    await retry;
    f.program.dispose();
    await f.stage.dispose();
  });
it('captures the opt-in program exactly once before stage source callbacks can replace it', async () => {
  let hook = () => {};
  const f = await fixture(() => hook()),
    bytes = new Uint8Array(100).fill(1);
  await fs.writeFile(executable, bytes);
  const program = await prepareFFmpegExecutable(executable, { validate: () => {} });
  let reads = 0;
  const options = {
    ...f.options,
    get program() {
      reads++;
      return program;
    },
  };
  hook = () => Object.defineProperty(options, 'program', { value: {}, configurable: true });
  const pending = runStagedFFmpeg(f.stage, options, f.spawn);
  f.children[0].complete();
  await pending;
  expect(reads).toBe(1);
  hook = () => {};
  program.dispose();
  await f.stage.dispose();
});
it('rejects retired program ownership initially, then accepts a fresh original selection', async () => {
  const f = await programFixture();
  f.program.dispose();
  await expect(
    runStagedFFmpeg(f.stage, { ...f.options, program: f.program }, f.spawn),
  ).rejects.toThrow(/disposed/);
  expect(f.spawn).not.toHaveBeenCalled();
  const fresh = await prepareFFmpegExecutable(executable, { validate: () => {} }),
    pending = runStagedFFmpeg(f.stage, { ...f.options, program: fresh }, f.spawn);
  f.children[0].complete();
  await pending;
  fresh.dispose();
  await f.stage.dispose();
});
it('rejects program disposal after complete native output construction and preserves fresh selection retries', async () => {
  const f = await programFixture(),
    freeze = Object.freeze,
    pending = runStagedFFmpeg(f.stage, { ...f.options, program: f.program }, f.spawn),
    assertion = expect(pending).rejects.toThrow(/program disposed/);
  let hits = 0;
  const spy = vi.spyOn(Object, 'freeze').mockImplementation((value) => {
    const out = freeze(value);
    if (
      out &&
      typeof out === 'object' &&
      Object.hasOwn(out, 'bytes') &&
      Object.hasOwn(out, 'requested')
    ) {
      hits++;
      f.program.dispose();
    }
    return out;
  });
  f.children[0].complete();
  await assertion;
  expect(hits).toBe(1);
  spy.mockRestore();
  const fresh = await prepareFFmpegExecutable(executable, { validate: () => {} }),
    retry = runStagedFFmpeg(f.stage, { ...f.options, program: fresh }, f.spawn);
  f.children[1].complete();
  await retry;
  fresh.dispose();
  await f.stage.dispose();
});
it('forwards original program-source cancellation to a quiet child and retains staging until close', async () => {
  const f = await fixture(),
    controller = new AbortController();
  await fs.writeFile(executable, new Uint8Array(100).fill(1));
  const program = await prepareFFmpegExecutable(executable, {
      validate: () => {},
      signal: controller.signal,
    }),
    signal = ffmpegExecutableSignal(program);
  const pending = runStagedFFmpeg(f.stage, { ...f.options, program }, f.spawn),
    assertion = expect(pending).rejects.toThrow(/program-source cancellation/),
    child = f.children[0];
  controller.abort(Error('program-source cancellation'));
  expect(child.kills).toHaveLength(1);
  await stillOwned(f.info.directory);
  child.emit('exit', 0, null);
  await stillOwned(f.info.directory);
  child.emit('close', null, 'SIGKILL');
  await assertion;
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  program.dispose();
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  await f.stage.dispose();
});
