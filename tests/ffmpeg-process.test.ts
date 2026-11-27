import { EventEmitter } from 'node:events';
import { spawn as nativeSpawn, type ChildProcess } from 'node:child_process';
import { resolve, parse } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  prepareFFmpegProcess,
  runFFmpegProcess,
  type FFmpegSpawn,
} from '../packages/export-video/src/ffmpeg-process';
const settings = {
  width: 32,
  height: 24,
  firstNumber: 2,
  frameCount: 3,
  rate: 30000,
  scale: 1001,
  audio: false,
};
const location = {
  executable: resolve('tools', 'FFmpeg build', 'ffmpeg.exe'),
  directory: resolve('.ffmpeg-stage', 'owned'),
};
const payload = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x18, 0x53, 0x80, 0x67]);
class Child extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kills: string[] = [];
  autoClose = true;
  killError = false;
  kill(signal: string) {
    this.kills.push(signal);
    if (this.killError) throw Error('kill failed');
    if (this.autoClose) queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
    return true;
  }
  complete(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}
function fixture(validate: () => void = () => {}) {
  const plan = prepareFFmpegProcess(settings, location, validate),
    children: Child[] = [],
    spawn = vi.fn((..._args: Parameters<FFmpegSpawn>) => {
      const child = new Child();
      children.push(child);
      return child as never;
    });
  return { plan, children, spawn };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('generates only original fixed lossless arguments, isolated no-shell pipes and detached complete output at close', async () => {
  const f = fixture(),
    s = { ...settings },
    where = { ...location },
    plan = prepareFFmpegProcess(s, where, () => {});
  s.frameCount = 1;
  where.executable = 'evil';
  const metadata = plan.metadata();
  metadata.frameCount = 999;
  metadata.directory = 'public';
  const job = runFFmpegProcess(plan, {}, f.spawn),
    child = f.children[0],
    bytes = payload();
  child.stdout.emit('data', bytes.subarray(0, 4));
  bytes.fill(0);
  child.stderr.emit('data', new Uint8Array([0xe2]));
  child.emit('exit', 0, null);
  let settled = false;
  void job.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  child.stderr.emit('data', new Uint8Array([0x82, 0xac]));
  child.stdout.emit('data', payload().subarray(4));
  child.emit('close', 0, null);
  const output = await job;
  expect(output.bytes).toEqual(payload());
  expect(output).toMatchObject({
    byteLength: 8,
    requested: { frameCount: 3, rate: 30000, scale: 1001, audio: false },
    diagnostics: '€',
  });
  expect(Object.isFrozen(output)).toBe(true);
  const [exe, args, options] = f.spawn.mock.calls[0];
  expect(exe).toBe(location.executable);
  expect(args).toEqual([
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
    '30000/1001',
    '-pattern_type',
    'sequence',
    '-start_number',
    '2',
    '-start_number_range',
    '1',
    '-i',
    'frame-%06d.png',
    '-map',
    '0:v:0',
    '-frames:v',
    '3',
    '-c:v',
    'ffv1',
    '-pix_fmt',
    'bgra',
    '-f',
    'matroska',
    'pipe:1',
  ]);
  expect(options).toMatchObject({
    cwd: location.directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: false,
    detached: false,
  });
  expect(options.env).not.toHaveProperty('FFREPORT');
  expect(options.env!.TEMP).toBe(location.directory);
  expect(child.listenerCount('close')).toBe(0);
  expect(child.stdout.listenerCount('data')).toBe(0);
  expect(child.kills).toEqual([]);
});
it('keeps explicit audio mapping/PCM and both local input protocol scopes separate', async () => {
  const f = fixture(),
    plan = prepareFFmpegProcess({ ...settings, audio: true }, location, () => {}),
    job = runFFmpegProcess(plan, {}, f.spawn),
    child = f.children[0];
  child.stdout.emit('data', payload());
  child.complete();
  expect((await job).requested.audio).toBe(true);
  const args = f.spawn.mock.calls[0][1];
  expect(args.filter((v) => v === '-protocol_whitelist')).toHaveLength(2);
  expect(args.slice(args.indexOf('audio.wav') - 3, args.indexOf('audio.wav') + 1)).toEqual([
    '-protocol_whitelist',
    'file,pipe',
    '-i',
    'audio.wav',
  ]);
  expect(args).toContain('1:a:0');
  expect(args).toContain('pcm_s16le');
});
for (const bad of [
  { width: NaN },
  { height: 0 },
  { width: 16385 },
  { width: 16384, height: 16384 },
  { firstNumber: 0 },
  { firstNumber: 2147483647 },
  { frameCount: 65533 },
  { frameCount: 1.5 },
  { rate: Infinity },
  { scale: 0 },
  { rate: 241, scale: 1 },
  { audio: null },
])
  it('rejects original numeric/count fields ' + JSON.stringify(bad), () => {
    expect(() =>
      prepareFFmpegProcess({ ...settings, ...bad } as typeof settings, location, () => {}),
    ).toThrow();
  });
it('rejects unknown command fields, unsafe locations and caller command strings without coercion', () => {
  const coercion = vi.fn(() => 32);
  expect(() =>
    prepareFFmpegProcess(
      { ...settings, width: { valueOf: coercion } } as never,
      location,
      () => {},
    ),
  ).toThrow();
  expect(coercion).not.toHaveBeenCalled();
  expect(() =>
    prepareFFmpegProcess(
      { ...settings, suggestedArguments: ['arbitrary'] } as never,
      location,
      () => {},
    ),
  ).toThrow(/fields/);
  for (const loc of [
    { ...location, executable: 'ffmpeg' },
    { ...location, directory: parse(resolve('.')).root },
    { ...location, executable: resolve('ffmpeg.cmd') },
    { ...location, executable: resolve('ffmpeg.bat') },
    { ...location, directory: location.directory + '\n' },
    { ...location, shell: true },
  ])
    expect(() => prepareFFmpegProcess(settings, loc as typeof location, () => {})).toThrow();
});
it('retains original one-shot targets/validator and rejects preparation getter/source/reentry without poisoning older plans', () => {
  const f = fixture();
  let calls = 0;
  const s = {
      ...settings,
      get width() {
        calls++;
        return 32;
      },
    },
    plan = prepareFFmpegProcess(s, location, () => {});
  expect(calls).toBe(1);
  plan.metadata();
  expect(calls).toBe(1);
  expect(() =>
    prepareFFmpegProcess(
      {
        ...settings,
        get width() {
          try {
            prepareFFmpegProcess(settings, location, () => {});
          } catch {}
          return 32;
        },
      },
      location,
      () => {},
    ),
  ).toThrow(/reentered/);
  expect(f.plan.metadata().width).toBe(32);
  let valid = true;
  expect(() =>
    prepareFFmpegProcess(
      settings,
      {
        ...location,
        get directory() {
          valid = false;
          return location.directory;
        },
      },
      () => {
        if (!valid) throw Error('late source');
      },
    ),
  ).toThrow(/source/);
  expect(() =>
    prepareFFmpegProcess(settings, location, (() => Promise.resolve()) as never),
  ).toThrow(/synchronous/);
});
it('accepts original boundary dimensions/counts/rational fields without allocating artwork or lower geometry caps', () => {
  const plan = prepareFFmpegProcess(
    {
      ...settings,
      width: 16384,
      height: 4096,
      firstNumber: 2147483647 - 65530,
      frameCount: 65531,
      rate: 2147483647,
      scale: 2147483647,
      audio: true,
    },
    location,
    () => {},
  );
  expect(plan.metadata()).toMatchObject({ frameCount: 65531, width: 16384, height: 4096 });
});
it('rejects copied/serialized/proxied capabilities before any public getters or spawn', async () => {
  const f = fixture(),
    getter = vi.fn();
  for (const plan of [
    {},
    JSON.parse(JSON.stringify(f.plan.metadata())),
    { ...f.plan },
    new Proxy(f.plan, {}),
  ])
    await expect(
      runFFmpegProcess(
        plan,
        {
          get maxBytes() {
            getter();
            return 10;
          },
        },
        f.spawn,
      ),
    ).rejects.toThrow(/original/);
  expect(getter).not.toHaveBeenCalled();
  expect(f.spawn).not.toHaveBeenCalled();
});
it.each([0, NaN, Infinity, 512 * 1024 * 1024 + 1, 1.5])(
  'rejects byte budget %s before spawn and retains retry',
  async (maxBytes) => {
    const f = fixture();
    await expect(runFFmpegProcess(f.plan, { maxBytes }, f.spawn)).rejects.toThrow(/limits/);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.plan.metadata().frameCount).toBe(3);
  },
);
it('admits exact output/diagnostic byte counts and rejects one extra without truncated publication', async () => {
  const f = fixture(),
    job = runFFmpegProcess(f.plan, { maxBytes: 8, maxDiagnostics: 3 }, f.spawn),
    child = f.children[0];
  child.stdout.emit('data', payload());
  child.stderr.emit('data', new Uint8Array([1, 2, 3]));
  child.complete();
  expect((await job).byteLength).toBe(8);
  for (const diagnostic of [false, true]) {
    const pending = runFFmpegProcess(f.plan, { maxBytes: 7, maxDiagnostics: 2 }, f.spawn),
      next = f.children.at(-1)!;
    if (diagnostic) next.stderr.emit('data', new Uint8Array([1, 2, 3]));
    else next.stdout.emit('data', payload());
    await expect(pending).rejects.toThrow(/budget/);
    expect(next.kills).toEqual(['SIGKILL']);
  }
});
it.each([
  'nonzero',
  'signal',
  'empty',
  'header',
  'string',
  'error',
  'pipe-error',
  'throw',
] as const)('rejects %s process failure with no container receipt', async (fault) => {
  const f = fixture();
  if (fault === 'throw') {
    f.spawn.mockImplementationOnce(() => {
      throw Error('spawn failed');
    });
    await expect(runFFmpegProcess(f.plan, {}, f.spawn)).rejects.toThrow(/spawn/);
    return;
  }
  const job = runFFmpegProcess(f.plan, {}, f.spawn),
    child = f.children[0];
  if (fault === 'string') child.stdout.emit('data', 'not binary');
  else if (fault === 'error') child.emit('error', Error('spawn error'));
  else if (fault === 'pipe-error') child.stdout.emit('error', Error('pipe failure'));
  else {
    if (fault !== 'empty')
      child.stdout.emit('data', fault === 'header' ? new Uint8Array([1, 2, 3, 4]) : payload());
    child.complete(fault === 'nonzero' ? 1 : 0, fault === 'signal' ? 'SIGTERM' : null);
  }
  await expect(job).rejects.toThrow();
  expect(f.plan.metadata().frameCount).toBe(3);
});
it('preabort starts no process; cancellation kills once and waits for actual stdio close', async () => {
  const f = fixture(),
    c = new AbortController();
  c.abort(Error('preabort'));
  await expect(runFFmpegProcess(f.plan, { signal: c.signal }, f.spawn)).rejects.toThrow('preabort');
  expect(f.spawn).not.toHaveBeenCalled();
  const controller = new AbortController(),
    job = runFFmpegProcess(f.plan, { signal: controller.signal }, f.spawn),
    child = f.children[0];
  child.autoClose = false;
  let settled = false;
  void job.catch(() => {
    settled = true;
  });
  controller.abort(Error('cancel child'));
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(child.kills).toEqual(['SIGKILL']);
  child.stdout.emit('data', payload());
  child.complete(null, 'SIGKILL');
  await expect(job).rejects.toThrow('cancel child');
  expect(child.stdout.listenerCount('data')).toBe(0);
});
it('uses one deadline, awaits termination and clears listeners/timers on success and failure', async () => {
  const f = fixture();
  vi.useFakeTimers();
  const job = runFFmpegProcess(f.plan, { timeoutMs: 5 }, f.spawn),
    rejected = expect(job).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(5);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  const retry = runFFmpegProcess(f.plan, {}, f.spawn),
    child = f.children.at(-1)!;
  child.stdout.emit('data', payload());
  child.complete();
  await retry;
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['source', 'cancel'] as const)(
  'rejects late %s after complete output copying and preserves an original retry',
  async (fault) => {
    let valid = true;
    const f = fixture(() => {
        if (!valid) throw Error('late source');
      }),
      c = new AbortController(),
      decode = TextDecoder.prototype.decode;
    let fired = false;
    vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (
      this: TextDecoder,
      ...args
    ) {
      const text = decode.apply(this, args);
      fired = true;
      if (fault === 'source') valid = false;
      else c.abort(Error('late cancel'));
      return text;
    });
    const job = runFFmpegProcess(f.plan, { signal: c.signal }, f.spawn),
      child = f.children[0];
    child.stdout.emit('data', payload());
    child.complete();
    await expect(job).rejects.toThrow(/late/);
    expect(fired).toBe(true);
    vi.restoreAllMocks();
    valid = true;
    const retry = runFFmpegProcess(f.plan, {}, f.spawn),
      next = f.children.at(-1)!;
    next.stdout.emit('data', payload());
    next.complete();
    expect((await retry).bytes).toEqual(payload());
  },
);
it('rejects source mutation/reentrant output and concurrent execution without stale receipts', async () => {
  let action: undefined | (() => void);
  const f = fixture(() => action?.()),
    job = runFFmpegProcess(f.plan, {}, f.spawn),
    child = f.children[0];
  action = () => {
    action = undefined;
    child.stdout.emit('data', payload());
  };
  child.stdout.emit('data', payload());
  await expect(job).rejects.toThrow(/reentered/);
  expect(child.kills).toEqual(['SIGKILL']);
  const active = runFFmpegProcess(f.plan, {}, f.spawn);
  await expect(runFFmpegProcess(f.plan, {}, f.spawn)).rejects.toThrow(/running/);
  await expect(active).rejects.toThrow(/reentered/);
});
it('disposal cancels an original process, permanently expires its capability and leaves no partial result', async () => {
  const f = fixture(),
    job = runFFmpegProcess(f.plan, {}, f.spawn);
  f.plan.dispose();
  await expect(job).rejects.toThrow(/disposed/);
  expect(() => f.plan.metadata()).toThrow(/disposed/);
  await expect(runFFmpegProcess(f.plan, {}, f.spawn)).rejects.toThrow(/disposed/);
  f.plan.dispose();
  expect(f.spawn).toHaveBeenCalledTimes(1);
});
it('rejects missing native pipes and still waits for termination cleanup', async () => {
  const f = fixture();
  f.spawn.mockImplementationOnce(() => {
    const child = new Child();
    child.stdout = undefined as never;
    f.children.push(child);
    return child as never;
  });
  await expect(runFFmpegProcess(f.plan, {}, f.spawn)).rejects.toThrow(/pipes/);
  expect(f.children[0].kills).toEqual(['SIGKILL']);
});
it('reports kill failure without recursive termination attempts and retains staging until close', async () => {
  const f = fixture(),
    c = new AbortController(),
    job = runFFmpegProcess(f.plan, { signal: c.signal }, f.spawn),
    child = f.children[0];
  child.killError = true;
  child.autoClose = false;
  let settled = false;
  void job.catch(() => {
    settled = true;
  });
  c.abort(Error('abort with failed kill'));
  await Promise.resolve();
  expect(settled).toBe(false);
  child.emit('error', Error('late kill error'));
  expect(child.kills).toEqual(['SIGKILL']);
  child.complete(null, 'SIGKILL');
  await expect(job).rejects.toThrow(/termination failed/);
});
it('rejects an actual abort during native spawn before returning the child and cleans it once', async () => {
  const f = fixture(),
    c = new AbortController();
  f.spawn.mockImplementationOnce(() => {
    const child = new Child();
    f.children.push(child);
    c.abort(Error('during spawn'));
    return child as never;
  });
  await expect(runFFmpegProcess(f.plan, { signal: c.signal }, f.spawn)).rejects.toThrow(
    'during spawn',
  );
  expect(f.children[0].kills).toEqual(['SIGKILL']);
});
it('rejects late async validation before launch and permits a source-valid retry', async () => {
  let asynchronous = false;
  const f = fixture((() => (asynchronous ? Promise.resolve() : undefined)) as never);
  asynchronous = true;
  await expect(runFFmpegProcess(f.plan, {}, f.spawn)).rejects.toThrow(/synchronous/);
  expect(f.spawn).not.toHaveBeenCalled();
  asynchronous = false;
  const job = runFFmpegProcess(f.plan, {}, f.spawn),
    child = f.children[0];
  child.stdout.emit('data', payload());
  child.complete();
  expect((await job).byteLength).toBe(8);
});
it('rejects swallowed option-getter execution reentry without poisoning the original capability', async () => {
  const f = fixture();
  await expect(
    runFFmpegProcess(
      f.plan,
      {
        get maxBytes() {
          void runFFmpegProcess(f.plan, {}, f.spawn).catch(() => {});
          return 8;
        },
      },
      f.spawn,
    ),
  ).rejects.toThrow(/reentered/);
  expect(f.spawn).not.toHaveBeenCalled();
  expect(f.plan.metadata().width).toBe(32);
});
it('copies hostile typed-array views intrinsically and retains split header/tail bytes', async () => {
  const f = fixture(),
    job = runFFmpegProcess(f.plan, {}, f.spawn),
    child = f.children[0];
  class Hostile extends Uint8Array {
    get byteLength(): number {
      throw Error('public byteLength');
    }
    get buffer(): ArrayBuffer {
      throw Error('public buffer');
    }
  }
  const storage = new Uint8Array([99, ...payload(), 88]);
  for (let i = 1; i <= 8; i++) child.stdout.emit('data', new Hostile(storage.buffer, i, 1));
  storage.fill(0);
  child.complete();
  expect((await job).bytes).toEqual(payload());
});
it('qualifies actual Node child pipes and close ordering with a developer-only byte fixture, not a codec', async () => {
  const plan = prepareFFmpegProcess(
    settings,
    { executable: process.execPath, directory: process.cwd() },
    () => {},
  );
  const spawn: FFmpegSpawn = (exe, args, options) => {
    expect(args.at(-1)).toBe('pipe:1');
    return nativeSpawn(
      exe,
      [
        '-e',
        "process.stdout.write(Buffer.from([26,69,223,163,24,83,128,103]));process.stderr.write('fixture diagnostics');",
      ],
      options,
    );
  };
  const result = await runFFmpegProcess(plan, { maxBytes: 8 }, spawn);
  expect(result.bytes).toEqual(payload());
  expect(result.diagnostics).toBe('fixture diagnostics');
});
it('qualifies actual direct-child kill and awaited close on external cancellation without a codec claim', async () => {
  const plan = prepareFFmpegProcess(
      settings,
      { executable: process.execPath, directory: process.cwd() },
      () => {},
    ),
    c = new AbortController();
  let child: ChildProcess | undefined,
    closed = false;
  const spawn: FFmpegSpawn = (exe, _args, options) => {
    child = nativeSpawn(
      exe,
      ['-e', 'process.stdout.write(Buffer.from([26,69,223,163]));setInterval(()=>{},1000);'],
      options,
    );
    child.once('close', () => {
      closed = true;
    });
    child.stdout!.once('data', () => c.abort(Error('actual child cancelled')));
    return child;
  };
  await expect(runFFmpegProcess(plan, { signal: c.signal }, spawn)).rejects.toThrow(
    'actual child cancelled',
  );
  expect(closed).toBe(true);
  expect(child!.killed).toBe(true);
});
it('uses the real default spawn without shell and rejects a non-FFmpeg executable exit without output', async () => {
  const plan = prepareFFmpegProcess(
    settings,
    { executable: process.execPath, directory: process.cwd() },
    () => {},
  );
  await expect(runFFmpegProcess(plan)).rejects.toThrow(/unsuccessfully/);
});
