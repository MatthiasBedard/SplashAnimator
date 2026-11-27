import { promises as fs } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  createFFmpegStage,
  verifyFFmpegStage,
  type FFmpegStageOptions,
} from '../packages/export-video/src/ffmpeg-stage';
import { pcm16WavFixture } from './wav-fixture';
import { png } from './ffmpeg-stage-fixture';
const originalSettings = {
  width: 2,
  height: 2,
  firstNumber: 2,
  frameCount: 3,
  rate: 30000,
  scale: 1001,
  audio: false,
};
let base: string, root: string, executable: string;
beforeEach(async () => {
  base = await fs.mkdtemp(join(process.cwd(), '.verification-ffmpeg-stage-'));
  root = join(base, 'allowed');
  executable = join(base, 'ffmpeg.exe');
  await fs.mkdir(root);
  await fs.writeFile(join(root, 'keep.txt'), 'user data');
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Only this test-created direct workspace child may be recursively removed.
  const target = resolve(base);
  if (
    dirname(target) !== resolve(process.cwd()) ||
    !basename(target).startsWith('.verification-ffmpeg-stage-')
  )
    throw Error('Unsafe fixture cleanup');
  await fs.rm(target, { recursive: true, force: true });
});
function fixture() {
  return {
    settings: { ...originalSettings },
    inputs: { frames: [png(), png(), png()] as Uint8Array[] },
    location: { root, executable },
    options: { validate: () => {} },
  };
}
function create(f = fixture(), options: FFmpegStageOptions = f.options) {
  return createFFmpegStage(f.settings, f.inputs, f.location, options);
}
async function empty() {
  expect(await fs.readdir(root)).toEqual(['keep.txt']);
  expect(await fs.readFile(join(root, 'keep.txt'), 'utf8')).toBe('user data');
}
it('writes exact exclusive detached PNG inputs, branded metadata, and only disposes its own private folder', async () => {
  const f = fixture(),
    originals = f.inputs.frames.map((b) => b.slice());
  const pending = create(f);
  f.inputs.frames[0].fill(0);
  f.inputs.frames.length = 0;
  f.settings.rate = 1;
  f.location.root = base;
  f.options.validate = () => {
    throw Error('replacement callback');
  };
  const stage = await pending,
    info = stage.metadata();
  expect(dirname(info.directory)).toBe(await fs.realpath(root));
  expect(info.executable).toBe(executable);
  expect(info.settings).toEqual(originalSettings);
  expect(info.byteLength).toBe(originals.reduce((n, b) => n + b.length, 0));
  expect(info.files.map((x) => x.name)).toEqual([
    'frame-000002.png',
    'frame-000003.png',
    'frame-000004.png',
  ]);
  for (const [i, file] of info.files.entries()) {
    expect(new Uint8Array(await fs.readFile(join(info.directory, file.name)))).toEqual(
      originals[i],
    );
    expect(file.sha256).toBe(createHash('sha256').update(originals[i]).digest('hex'));
  }
  info.settings.width = 999;
  info.files[0].name = 'user.txt';
  info.files.length = 0;
  expect(stage.metadata().settings.width).toBe(2);
  verifyFFmpegStage(stage);
  await stage.dispose();
  await stage.dispose();
  await empty();
  expect(() => stage.metadata()).toThrow(/available/);
});
it('stages matching canonical stereo PCM at the exact rational selected range and exact combined budget', async () => {
  const f = fixture(),
    audio = pcm16WavFixture([Array(4804).fill(123), Array(4804).fill(-456)], 48000);
  f.settings.audio = true;
  const inputs = { frames: f.inputs.frames, audio },
    maxBytes = audio.length + f.inputs.frames.reduce((n, b) => n + b.length, 0);
  const stage = await createFFmpegStage(f.settings, inputs, f.location, {
    validate: () => {},
    maxBytes,
  });
  expect(stage.metadata().byteLength).toBe(maxBytes);
  expect(new Uint8Array(await fs.readFile(join(stage.metadata().directory, 'audio.wav')))).toEqual(
    audio,
  );
  await stage.dispose();
  await empty();
  await expect(
    createFFmpegStage(f.settings, inputs, f.location, {
      validate: () => {},
      maxBytes: maxBytes - 1,
    }),
  ).rejects.toThrow(/budget/);
  await empty();
});
it('cannot execute, verify or delete with copied, extracted, serialized or proxied capabilities', async () => {
  const stage = await create(),
    copy = { ...stage },
    proxy = new Proxy(stage, {}),
    metadata = stage.metadata;
  for (const value of [
    copy,
    proxy,
    stage.metadata(),
    JSON.parse(JSON.stringify(stage.metadata())),
    {},
  ])
    expect(() => verifyFFmpegStage(value)).toThrow(/original/);
  expect(() => metadata()).toThrow(/original/);
  expect(() => copy.metadata()).toThrow(/original/);
  await expect(copy.dispose()).rejects.toThrow(/original/);
  await expect(proxy.dispose()).rejects.toThrow(/original/);
  verifyFFmpegStage(stage);
  await stage.dispose();
});
for (const [key, value] of [
  ['width', NaN],
  ['height', Infinity],
  ['frameCount', 1.5],
  ['firstNumber', 0],
  ['rate', '30'],
  ['scale', 0],
  ['audio', 1],
  ['unknown', true],
] as const)
  it(`rejects original raw settings ${key} before creating a directory`, async () => {
    const f = fixture();
    Object.assign(f.settings, { [key]: value });
    await expect(create(f)).rejects.toThrow();
    await empty();
  });
for (const mode of [
  'missing',
  'extra',
  'hole',
  'bad later',
  'growing',
  'audio missing',
  'unknown input',
  'unknown location',
  'unknown option',
  'async validator',
  'shared',
  'detached',
] as const)
  it(`rejects ${mode} preparation atomically before filesystem output`, async () => {
    const f = fixture();
    switch (mode) {
      case 'missing':
        f.inputs.frames.pop();
        break;
      case 'extra':
        f.inputs.frames.push(png());
        break;
      case 'hole':
        delete f.inputs.frames[1];
        break;
      case 'bad later':
        f.inputs.frames[2][0] = 0;
        break;
      case 'growing': {
        const bytes = f.inputs.frames[2];
        Object.defineProperty(f.inputs.frames, 2, {
          get() {
            f.inputs.frames.push(png());
            return bytes;
          },
        });
        break;
      }
      case 'audio missing':
        f.settings.audio = true;
        break;
      case 'unknown input':
        Object.assign(f.inputs, { suggestedArguments: ['unsafe'] });
        break;
      case 'unknown location':
        Object.assign(f.location, { directory: base });
        break;
      case 'unknown option':
        Object.assign(f.options, { shell: true });
        break;
      case 'async validator':
        f.options.validate = async () => {};
        break;
      case 'shared':
        f.inputs.frames[0] = new Uint8Array(new SharedArrayBuffer(png().length));
        break;
      case 'detached': {
        const b = png();
        structuredClone(b, { transfer: [b.buffer] });
        f.inputs.frames[0] = b;
        break;
      }
    }
    await expect(create(f)).rejects.toThrow();
    await empty();
  });
it('copies original byte views intrinsically, ignoring public byteLength/buffer/slice getters', async () => {
  const f = fixture(),
    bytes = png(),
    storage = new Uint8Array(bytes.length + 8);
  storage.set(bytes, 4);
  const view = storage.subarray(4, 4 + bytes.length);
  for (const name of ['byteLength', 'buffer', 'byteOffset', 'slice'])
    Object.defineProperty(view, name, {
      get() {
        throw Error('public byte getter');
      },
    });
  f.inputs.frames[0] = view;
  const stage = await create(f);
  expect(
    new Uint8Array(await fs.readFile(join(stage.metadata().directory, 'frame-000002.png'))),
  ).toEqual(bytes);
  await stage.dispose();
});
it('reads target getters once, rejects getter source changes and swallowed synchronous reentry', async () => {
  const f = fixture();
  let valid = true,
    reads = 0;
  Object.defineProperty(f.settings, 'width', {
    get() {
      reads++;
      valid = false;
      return 2;
    },
  });
  f.options.validate = () => {
    if (!valid) throw Error('source changed');
  };
  await expect(create(f)).rejects.toThrow(/source/);
  expect(reads).toBe(1);
  await empty();
  const g = fixture();
  let reenter = true;
  g.options.validate = () => {
    if (reenter) {
      reenter = false;
      void create(g).catch(() => {});
    }
  };
  await expect(create(g)).rejects.toThrow(/reentered/);
  await empty();
  const retry = await create();
  await retry.dispose();
});
for (const mode of ['source', 'cancel', 'timeout', 'partial write'] as const)
  it(`closes handles and cleans only owned input after ${mode} during native write`, async () => {
    const f = fixture(),
      controller = new AbortController(),
      nativeOpen = fs.open.bind(fs);
    let valid = true,
      opened = 0,
      closed = 0,
      time = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => time);
    f.options.validate = () => {
      if (!valid) throw Error('source changed');
    };
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const h = await nativeOpen(...args),
        write = h.writeFile.bind(h),
        close = h.close.bind(h);
      opened++;
      vi.spyOn(h, 'close').mockImplementation(async () => {
        closed++;
        await close();
      });
      vi.spyOn(h, 'writeFile').mockImplementation(async (data) => {
        const bytes = data as Uint8Array;
        if (mode === 'partial write') {
          await write(bytes.subarray(0, 10));
          throw Error('partial native failure');
        }
        await write(bytes);
        if (mode === 'source') valid = false;
        if (mode === 'cancel') controller.abort();
        if (mode === 'timeout') time = 60001;
      });
      return h;
    });
    await expect(create(f, { ...f.options, signal: controller.signal })).rejects.toThrow();
    clock.mockRestore();
    expect(opened).toBe(1);
    expect(closed).toBe(1);
    await empty();
  });
it('awaits a held native open and closes its late original handle before cancellation settles', async () => {
  const nativeOpen = fs.open.bind(fs),
    controller = new AbortController();
  let release!: () => void,
    entered!: () => void,
    handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    handle = await nativeOpen(...args);
    entered();
    await gate;
    return handle;
  });
  const pending = create(fixture(), { validate: () => {}, signal: controller.signal }),
    assertion = expect(pending).rejects.toThrow();
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await ready;
  controller.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await assertion;
  expect(handle!.fd).toBe(-1);
  await empty();
});
it('rejects replacement of the original root during its first asynchronous canonical read', async () => {
  const realpath = fs.realpath.bind(fs),
    backup = join(base, 'original-root');
  let replaced = false;
  vi.spyOn(fs, 'realpath').mockImplementation(async (path) => {
    const value = await realpath(path);
    if (!replaced) {
      replaced = true;
      await fs.rename(root, backup);
      await fs.mkdir(root);
      await fs.writeFile(join(root, 'foreign.txt'), 'keep foreign');
    }
    return value;
  });
  await expect(create()).rejects.toThrow(/root changed/);
  expect(await fs.readdir(root)).toEqual(['foreign.txt']);
  expect(await fs.readFile(join(root, 'foreign.txt'), 'utf8')).toBe('keep foreign');
  expect(await fs.readdir(backup)).toEqual(['keep.txt']);
});
for (const mode of [
  'unknown entry',
  'content',
  'inode',
  'hardlink',
  'junction',
  'directory',
  'root',
] as const)
  it(`refuses verification and cleanup of ${mode} replacement, preserves data and supports restored retry`, async () => {
    const stage = await create(),
      info = stage.metadata(),
      file = join(info.directory, info.files[0].name),
      original = await fs.readFile(file),
      backup = join(base, 'backup');
    let restore: () => Promise<void>;
    if (mode === 'unknown entry') {
      const extra = join(info.directory, 'user-art.png');
      await fs.writeFile(extra, 'foreign');
      restore = () => fs.unlink(extra);
    } else if (mode === 'content') {
      await fs.writeFile(file, new Uint8Array(original.length).fill(7));
      restore = async () => {
        await fs.writeFile(file, original);
      };
    } else if (mode === 'directory' || mode === 'root') {
      const target = mode === 'root' ? root : info.directory;
      await fs.rename(target, backup);
      await fs.mkdir(target);
      await fs.writeFile(join(target, 'foreign.txt'), 'foreign');
      restore = async () => {
        expect(await fs.readFile(join(target, 'foreign.txt'), 'utf8')).toBe('foreign');
        await fs.unlink(join(target, 'foreign.txt'));
        await fs.rmdir(target);
        await fs.rename(backup, target);
      };
    } else {
      await fs.rename(file, backup);
      if (mode === 'inode') await fs.writeFile(file, original);
      if (mode === 'hardlink') await fs.link(backup, file);
      if (mode === 'junction') {
        const target = join(base, 'foreign-directory');
        await fs.mkdir(target);
        await fs.writeFile(join(target, 'keep.txt'), 'foreign');
        await fs.symlink(target, file, 'junction');
      }
      restore = async () => {
        if (mode === 'junction') {
          expect(await fs.readFile(join(file, 'keep.txt'), 'utf8')).toBe('foreign');
          await fs.rmdir(file);
        } else await fs.unlink(file);
        await fs.rename(backup, file);
      };
    }
    expect(() => verifyFFmpegStage(stage)).toThrow();
    await expect(stage.dispose()).rejects.toThrow();
    if (mode === 'unknown entry') expect(await fs.readdir(info.directory)).toHaveLength(4);
    await restore();
    verifyFFmpegStage(stage);
    await stage.dispose();
    await empty();
  });
it('rejects an authorized-looking root junction before creating staged data', async () => {
  const alias = join(base, 'root-alias');
  await fs.symlink(root, alias, 'junction');
  const f = fixture();
  f.location.root = alias;
  await expect(create(f)).rejects.toThrow(/links/);
  await empty();
});
it('rejects source-invalid reads but still disposes safely, without consulting a replaced callback', async () => {
  let valid = true;
  const f = fixture();
  f.options.validate = () => {
    if (!valid) throw Error('source invalid');
  };
  const stage = await create(f);
  valid = false;
  f.options.validate = () => {};
  expect(() => stage.metadata()).toThrow(/source invalid/);
  await stage.dispose();
  await empty();
});
it('taints swallowed verification/disposal reentry and then allows a source-valid retry', async () => {
  let hook: undefined | (() => void);
  const stage = await create(fixture(), { validate: () => hook?.() });
  hook = () => {
    try {
      verifyFFmpegStage(stage);
    } catch {
      /* swallowed by hostile source callback */
    }
  };
  expect(() => stage.metadata()).toThrow(/reentered/);
  hook = undefined;
  verifyFFmpegStage(stage);
  let nested: Promise<void> | undefined;
  hook = () => {
    nested = stage.dispose();
    void nested.catch(() => {});
  };
  expect(() => stage.metadata()).toThrow(/reentered/);
  await expect(nested).rejects.toThrow(/reentered/);
  hook = undefined;
  await stage.dispose();
  await empty();
});
it('cleanup failures retain remaining ownership for retry and never delete the root or other artwork', async () => {
  const unlink = fs.unlink.bind(fs);
  let count = 0;
  vi.spyOn(fs, 'unlink').mockImplementation(async (path) => {
    if (++count === 2) throw Error('native unlink failed');
    await unlink(path);
  });
  const stage = await create(),
    dir = stage.metadata().directory;
  await expect(stage.dispose()).rejects.toThrow(/unlink failed/);
  expect(await fs.readdir(dir)).toHaveLength(2);
  await stage.dispose();
  await empty();
});
for (const [key, value] of [
  ['timeoutMs', 0],
  ['timeoutMs', 60001],
  ['timeoutMs', NaN],
  ['maxBytes', 0],
  ['maxBytes', 512 * 1024 * 1024 + 1],
  ['maxBytes', '512'],
  ['signal', {}],
  ['validate', null],
] as const)
  it(`rejects invalid ${key}=${String(value)} before output`, async () => {
    const f = fixture();
    Object.assign(f.options, { [key]: value });
    await expect(create(f)).rejects.toThrow();
    await empty();
  });
it('does not borrow inherited frame slots to fill missing original inputs', async () => {
  const f = fixture(),
    prototype = Object.create(Array.prototype);
  prototype[1] = png();
  delete f.inputs.frames[1];
  Object.setPrototypeOf(f.inputs.frames, prototype);
  await expect(create(f)).rejects.toThrow(/missing/);
  await empty();
});
it('rejects initially cancelled preparation before any directory and permits a fresh retry', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    create(fixture(), { validate: () => {}, signal: controller.signal }),
  ).rejects.toThrow();
  await empty();
  const stage = await create();
  await stage.dispose();
});
it('admits final original source after complete branded-object construction and cleans on late failure', async () => {
  const f = fixture(),
    freeze = Object.freeze;
  let valid = true,
    hits = 0;
  f.options.validate = () => {
    if (!valid) throw Error('late source');
  };
  vi.spyOn(Object, 'freeze').mockImplementation((value) => {
    const out = freeze(value);
    if (
      out &&
      typeof out === 'object' &&
      Object.hasOwn(out, 'metadata') &&
      Object.hasOwn(out, 'dispose') &&
      !Object.hasOwn(out, 'consume')
    ) {
      valid = false;
      hits++;
    }
    return out;
  });
  await expect(create(f)).rejects.toThrow(/late source/);
  expect(hits).toBe(1);
  await empty();
});
it('rechecks source after cloning the complete detached metadata file list', async () => {
  const f = fixture();
  let valid = true;
  f.options.validate = () => {
    if (!valid) throw Error('late metadata source');
  };
  const stage = await create(f);
  const map = Array.prototype.map;
  let hits = 0;
  const spy = vi.spyOn(Array.prototype, 'map').mockImplementation(function (
    this: unknown[],
    fn: (value: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    const out = map.call(this, fn, thisArg);
    if (
      out.length === 3 &&
      out.every(
        (value) =>
          value &&
          typeof value === 'object' &&
          Object.hasOwn(value, 'sha256') &&
          Object.hasOwn(value, 'size'),
      )
    ) {
      valid = false;
      hits++;
    }
    return out;
  });
  expect(() => stage.metadata()).toThrow(/late metadata source/);
  expect(hits).toBe(1);
  spy.mockRestore();
  await stage.dispose();
  await empty();
});
it('reports refused failure cleanup instead of deleting a foreign file injected during a native write', async () => {
  const nativeOpen = fs.open.bind(fs);
  let valid = true,
    dir = '';
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const h = await nativeOpen(...args),
      write = h.writeFile.bind(h);
    vi.spyOn(h, 'writeFile').mockImplementation(async (bytes) => {
      await write(bytes);
      dir = dirname(String(args[0]));
      await fs.writeFile(join(dir, 'foreign-artwork.png'), 'keep this');
      valid = false;
    });
    return h;
  });
  const failure = await create(fixture(), {
    validate: () => {
      if (!valid) throw Error('source changed');
    },
  }).catch((error) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors.map((error: Error) => error.message)).toEqual([
    expect.stringContaining('source changed'),
    expect.stringContaining('unowned entries'),
  ]);
  expect(await fs.readFile(join(dir, 'foreign-artwork.png'), 'utf8')).toBe('keep this');
  expect(await fs.readdir(dir)).toEqual(['foreign-artwork.png', 'frame-000002.png']);
  expect(await fs.readFile(join(root, 'keep.txt'), 'utf8')).toBe('user data');
});
