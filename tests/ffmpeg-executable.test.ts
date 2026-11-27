import fsNative, { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { join, resolve, dirname, basename } from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  prepareFFmpegExecutable,
  verifyFFmpegExecutable,
  ffmpegExecutableSignal,
  type FFmpegExecutableOptions,
} from '../packages/export-video/src/ffmpeg-executable';
let base: string, path: string, body: Uint8Array;
beforeEach(async () => {
  base = await fs.mkdtemp(join(process.cwd(), '.verification-ffmpeg-program-'));
  path = join(base, 'selected encoder.exe');
  body = Uint8Array.from({ length: 65553 }, (_, i) => (i * 17 + 3) % 256);
  await fs.writeFile(path, body);
  await fs.writeFile(join(base, 'keep.txt'), 'user artwork');
});
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  const target = resolve(base);
  if (
    dirname(target) !== resolve(process.cwd()) ||
    !basename(target).startsWith('.verification-ffmpeg-program-')
  )
    throw Error('Unsafe fixture cleanup');
  await fs.rm(target, { recursive: true, force: true });
});
const options = (): FFmpegExecutableOptions => ({
  validate: (selected) => {
    if (selected !== path) throw Error('wrong selected program');
  },
});
it('captures exact bounded selected-file identity/hash with detached public metadata and no program modification', async () => {
  const owner = await prepareFFmpegExecutable(path, { ...options(), maxBytes: body.length }),
    info = owner.metadata();
  expect(info).toEqual({
    path,
    canonicalPath: await fs.realpath(path),
    byteLength: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
  info.path = 'other.exe';
  info.sha256 = 'forged';
  info.byteLength = 0;
  verifyFFmpegExecutable(owner, path, true);
  expect(owner.metadata().byteLength).toBe(body.length);
  const signal = ffmpegExecutableSignal(owner);
  owner.dispose();
  owner.dispose();
  expect(signal.aborted).toBe(true);
  expect(() => owner.metadata()).toThrow(/disposed/);
  expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
  expect(await fs.readFile(join(base, 'keep.txt'), 'utf8')).toBe('user artwork');
});
it('rejects exact-budget-minus-one before opening or reading the program', async () => {
  const open = vi.spyOn(fs, 'open');
  await expect(
    prepareFFmpegExecutable(path, { ...options(), maxBytes: body.length - 1 }),
  ).rejects.toThrow(/budget/);
  expect(open).not.toHaveBeenCalled();
});
it('ignores replacement callbacks/options after capture and reads raw approval/options getters once', async () => {
  const raw = options();
  let reads = 0;
  Object.defineProperty(raw, 'validate', {
    get() {
      reads++;
      return () => {};
    },
    configurable: true,
  });
  const pending = prepareFFmpegExecutable(path, raw);
  Object.defineProperty(raw, 'validate', {
    value: () => {
      throw Error('replacement');
    },
  });
  raw.maxBytes = 0;
  const owner = await pending;
  expect(reads).toBe(1);
  owner.metadata();
  owner.dispose();
});
for (const [key, value] of [
  ['timeoutMs', 0],
  ['timeoutMs', NaN],
  ['timeoutMs', 60001],
  ['maxBytes', 0],
  ['maxBytes', Infinity],
  ['maxBytes', 512 * 1024 * 1024 + 1],
  ['signal', {}],
  ['validate', null],
  ['shell', true],
] as const)
  it(`rejects invalid raw program option ${key}`, async () => {
    const raw = options();
    Object.assign(raw, { [key]: value });
    const open = vi.spyOn(fs, 'open');
    await expect(prepareFFmpegExecutable(path, raw)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
for (const mode of [
  'relative',
  'nul',
  'newline',
  'shell bat',
  'shell cmd',
  'dot segment',
  'directory',
  'missing',
  'empty',
] as const)
  it(`rejects ${mode} file selection before program bytes`, async () => {
    let selected = path;
    if (mode === 'relative') selected = 'selected.exe';
    if (mode === 'nul') selected += '\0';
    if (mode === 'newline') selected += '\n';
    if (mode === 'shell bat') selected = join(base, 'script.bat');
    if (mode === 'shell cmd') selected = join(base, 'script.cmd');
    if (mode === 'dot segment') selected = base + '\\.\\selected encoder.exe';
    if (mode === 'directory') selected = base;
    if (mode === 'missing') selected = join(base, 'missing.exe');
    if (mode === 'empty') await fs.truncate(path, 0);
    const open = vi.spyOn(fs, 'open');
    await expect(prepareFFmpegExecutable(selected, { validate: () => {} })).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
it('rejects copied/extracted/proxied/serialized metadata as executable authority', async () => {
  const owner = await prepareFFmpegExecutable(path, options()),
    method = owner.metadata;
  for (const value of [
    { ...owner },
    new Proxy(owner, {}),
    owner.metadata(),
    JSON.parse(JSON.stringify(owner.metadata())),
    {},
  ]) {
    expect(() => verifyFFmpegExecutable(value, path, true)).toThrow(/original/);
    expect(() => ffmpegExecutableSignal(value)).toThrow(/original/);
  }
  expect(() => method()).toThrow(/original/);
  expect(() => ({ ...owner }).dispose()).toThrow(/original/);
  expect(() => verifyFFmpegExecutable(owner, join(base, 'other.exe'))).toThrow(/original.*path/);
  expect(() => verifyFFmpegExecutable(owner, path, 'yes' as unknown as boolean)).toThrow(
    /original.*path/,
  );
  owner.metadata();
  owner.dispose();
});
it('rejects initially aborted/asynchronous authority before reading and permits fresh capture', async () => {
  const controller = new AbortController();
  controller.abort();
  const open = vi.spyOn(fs, 'open');
  await expect(
    prepareFFmpegExecutable(path, { ...options(), signal: controller.signal }),
  ).rejects.toThrow();
  await expect(prepareFFmpegExecutable(path, { validate: async () => {} })).rejects.toThrow(
    /synchronous/,
  );
  expect(open).not.toHaveBeenCalled();
  const owner = await prepareFFmpegExecutable(path, options());
  owner.dispose();
});
it('rejects a file changed by original option getters before any native open', async () => {
  const open = vi.spyOn(fs, 'open');
  const raw = {
    get validate() {
      fsNative.writeFileSync(path, new Uint8Array(body.length).fill(9));
      return () => {};
    },
  };
  await expect(prepareFFmpegExecutable(path, raw)).rejects.toThrow(/changed/);
  expect(open).not.toHaveBeenCalled();
  expect((await fs.readFile(path))[0]).toBe(9);
});
it('rejects swallowed recursive capture in initial and asynchronous-source validation', async () => {
  for (const asynchronous of [false, true]) {
    let calls = 0,
      armed = true;
    const raw = {
      validate: () => {
        calls++;
        if (armed && calls >= (asynchronous ? 3 : 1)) {
          armed = false;
          void prepareFFmpegExecutable(path, { validate: () => {} }).catch(() => {});
        }
      },
    };
    await expect(prepareFFmpegExecutable(path, raw)).rejects.toThrow(/reentered/);
  }
  const owner = await prepareFFmpegExecutable(path, options());
  owner.dispose();
});
for (const mode of [
  'source',
  'cancel',
  'timeout',
  'incomplete',
  'read failure',
  'close failure',
] as const)
  it(`closes the original native handle after ${mode} during read without deleting or modifying the program`, async () => {
    const nativeOpen = fs.open.bind(fs),
      controller = new AbortController();
    let valid = true,
      time = 0,
      opened = 0,
      closed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await nativeOpen(...args),
        read = handle.read.bind(handle),
        close = handle.close.bind(handle);
      opened++;
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        closed++;
        await close();
        if (mode === 'close failure') throw Error('native close failed');
      });
      vi.spyOn(handle, 'read').mockImplementation((async (
        ...args: Parameters<typeof handle.read>
      ) => {
        if (mode === 'read failure') throw Error('native read failed');
        const result = await read(...args);
        if (mode === 'source') valid = false;
        if (mode === 'cancel') controller.abort();
        if (mode === 'timeout') time = 60001;
        if (mode === 'incomplete') return { ...result, bytesRead: 0 };
        return result;
      }) as typeof handle.read);
      return handle;
    });
    await expect(
      prepareFFmpegExecutable(path, {
        validate: () => {
          if (!valid) throw Error('source changed');
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(opened).toBe(1);
    expect(closed).toBe(1);
    expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
  });
it('awaits a held native read before closing and rejecting a cancelled capture', async () => {
  const nativeOpen = fs.open.bind(fs),
    controller = new AbortController();
  let enter!: () => void,
    release!: () => void,
    handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const ready = new Promise<void>((r) => {
      enter = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const opened = await nativeOpen(...args);
    handle = opened;
    const read = opened.read.bind(opened);
    vi.spyOn(opened, 'read').mockImplementation((async (
      ...args: Parameters<typeof opened.read>
    ) => {
      const result = await read(...args);
      enter();
      await gate;
      return result;
    }) as typeof handle.read);
    return opened;
  });
  const pending = prepareFFmpegExecutable(path, { ...options(), signal: controller.signal }),
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
  expect(handle!.fd).not.toBe(-1);
  release();
  await assertion;
  expect(handle!.fd).toBe(-1);
});
for (const mode of ['content', 'inode', 'hardlink', 'junction parent'] as const)
  it(`rejects ${mode} replacement while preserving data and allowing original/fresh capture recovery`, async () => {
    const owner = await prepareFFmpegExecutable(path, options()),
      backup = join(base, 'original.exe');
    let restore: () => Promise<void>;
    if (mode === 'content') {
      await fs.writeFile(path, new Uint8Array(body.length).fill(7));
      expect(() => verifyFFmpegExecutable(owner, path)).toThrow(/changed/);
      expect(() => verifyFFmpegExecutable(owner, path, true)).toThrow(/content changed/);
      restore = async () => {
        await fs.writeFile(path, body);
      };
    } else if (mode === 'inode') {
      await fs.rename(path, backup);
      await fs.writeFile(path, body);
      restore = async () => {
        await fs.unlink(path);
        await fs.rename(backup, path);
      };
    } else if (mode === 'hardlink') {
      await fs.link(path, backup);
      restore = () => fs.unlink(backup);
    } else {
      const alias = join(base, 'alias');
      await fs.symlink(base, alias, 'junction');
      await expect(
        prepareFFmpegExecutable(join(alias, basename(path)), { validate: () => {} }),
      ).rejects.toThrow(/links/);
      restore = () => fs.rmdir(alias);
    }
    if (mode !== 'junction parent') {
      expect(() => owner.metadata()).toThrow();
    }
    await restore();
    verifyFFmpegExecutable(owner, path, true);
    owner.dispose();
    expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
  });
it('rejects replacement during a held first open using the originally captured file identity', async () => {
  const nativeOpen = fs.open.bind(fs),
    backup = join(base, 'old.exe');
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    await fs.rename(path, backup);
    await fs.writeFile(path, body);
    return nativeOpen(...args);
  });
  await expect(prepareFFmpegExecutable(path, options())).rejects.toThrow(/changed/);
  expect(new Uint8Array(await fs.readFile(backup))).toEqual(body);
  expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
});
it('rejects verification/disposal reentry without consuming a source-valid owner', async () => {
  let hook = () => {};
  const owner = await prepareFFmpegExecutable(path, { validate: () => hook() });
  hook = () => {
    try {
      owner.metadata();
    } catch {
      /* malicious swallowed reentry */
    }
  };
  expect(() => owner.metadata()).toThrow(/reentered/);
  hook = () => {
    try {
      owner.dispose();
    } catch {
      /* malicious swallowed disposal */
    }
  };
  expect(() => owner.metadata()).toThrow(/reentered/);
  hook = () => {};
  owner.metadata();
  owner.dispose();
});
it('does not silently expire idle selection ownership, while each new verification remains bounded', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const owner = await prepareFFmpegExecutable(path, options());
  now = 120000;
  owner.metadata();
  owner.dispose();
});
it('rechecks original authority after complete capability construction', async () => {
  let valid = true,
    hits = 0;
  const freeze = Object.freeze;
  vi.spyOn(Object, 'freeze').mockImplementation((value) => {
    const result = freeze(value);
    if (
      result &&
      typeof result === 'object' &&
      Object.hasOwn(result, 'metadata') &&
      Object.hasOwn(result, 'dispose')
    ) {
      valid = false;
      hits++;
    }
    return result;
  });
  await expect(
    prepareFFmpegExecutable(path, {
      validate: () => {
        if (!valid) throw Error('late authority');
      },
    }),
  ).rejects.toThrow(/late authority/);
  expect(hits).toBe(1);
  expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
});
it('preserves both asynchronous read and handle cleanup failures', async () => {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args),
      close = handle.close.bind(handle);
    vi.spyOn(handle, 'read').mockRejectedValue(Error('original read failed'));
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await close();
      throw Error('original close failed');
    });
    return handle;
  });
  const error = await prepareFFmpegExecutable(path, options()).catch((error) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors.map((e: Error) => e.message)).toEqual([
    'original read failed',
    'original close failed',
  ]);
});
it('preserves synchronous content/close errors and allows restored content verification', async () => {
  const close = fsNative.closeSync;
  let fail = false;
  vi.spyOn(fsNative, 'closeSync').mockImplementation((fd) => {
    close(fd);
    if (fail) throw Error('sync close failed');
  });
  const owner = await prepareFFmpegExecutable(path, options());
  await fs.writeFile(path, new Uint8Array(body.length).fill(1));
  fail = true;
  let failure: unknown;
  try {
    verifyFFmpegExecutable(owner, path, true);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  const errors = (failure as AggregateError).errors as Error[];
  expect(errors[0].message).toContain('content changed');
  expect(errors[1].message).toBe('sync close failed');
  fail = false;
  await fs.writeFile(path, body);
  verifyFFmpegExecutable(owner, path, true);
  owner.dispose();
});
it('rejects initial hardlinked selection before native open without deleting either link', async () => {
  const other = join(base, 'linked.exe');
  await fs.link(path, other);
  const open = vi.spyOn(fs, 'open');
  await expect(prepareFFmpegExecutable(path, options())).rejects.toThrow(/regular-file/);
  expect(open).not.toHaveBeenCalled();
  expect(new Uint8Array(await fs.readFile(other))).toEqual(body);
});
it('bounds verification work after idle selection without restarting an active verification deadline', async () => {
  let now = 0,
    armed = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const owner = await prepareFFmpegExecutable(path, {
    validate: () => {
      if (armed) now += 60001;
    },
  });
  now = 120000;
  armed = true;
  expect(() => owner.metadata()).toThrow(/timed out/);
  armed = false;
  owner.metadata();
  owner.dispose();
});
for (const bytesRead of [NaN, Infinity, -1, 1.5])
  it(`rejects nonfinite/noninteger native read receipt ${String(bytesRead)} and closes its handle`, async () => {
    const open = fs.open.bind(fs);
    let closed = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args),
        close = handle.close.bind(handle);
      vi.spyOn(handle, 'read').mockResolvedValue({ bytesRead, buffer: new Uint8Array(1) });
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        closed++;
        await close();
      });
      return handle;
    });
    await expect(prepareFFmpegExecutable(path, options())).rejects.toThrow(/budget/);
    expect(closed).toBe(1);
  });
it('rejects source changes after awaited original handle close before capability publication', async () => {
  const open = fs.open.bind(fs);
  let valid = true;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args),
      close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await close();
      valid = false;
    });
    return handle;
  });
  await expect(
    prepareFFmpegExecutable(path, {
      validate: () => {
        if (!valid) throw Error('post-close authority changed');
      },
    }),
  ).rejects.toThrow(/post-close authority/);
  expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
});
it('bounds each original asynchronous program read to64KiB and retains every input byte', async () => {
  const open = fs.open.bind(fs),
    requests: number[] = [],
    buffers: number[] = [];
  let received = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args),
      read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation((async (
      ...args: Parameters<typeof handle.read>
    ) => {
      const request = args[0] as { buffer: Uint8Array; length: number };
      requests.push(request.length);
      buffers.push(request.buffer.byteLength);
      const result = await read(...args);
      received += result.bytesRead;
      return result;
    }) as typeof handle.read);
    return handle;
  });
  const owner = await prepareFFmpegExecutable(path, options());
  expect(requests.length).toBeGreaterThan(2);
  expect(Math.max(...requests)).toBeLessThanOrEqual(65536);
  expect(Math.max(...buffers)).toBeLessThanOrEqual(65536);
  expect(received).toBe(body.length);
  owner.dispose();
});
it('captures native source-signal methods/reason, forwards cancellation, and removes lifetime listeners on disposal', async () => {
  const controller = new AbortController(),
    signal = controller.signal;
  for (const key of ['addEventListener', 'removeEventListener', 'throwIfAborted', 'reason'])
    Object.defineProperty(signal, key, {
      get() {
        throw Error('public signal override');
      },
    });
  const owner = await prepareFFmpegExecutable(path, { ...options(), signal }),
    privateSignal = ffmpegExecutableSignal(owner);
  expect(getEventListeners(signal, 'abort')).toHaveLength(1);
  controller.abort(Error('original program cancellation'));
  expect(privateSignal.aborted).toBe(true);
  expect(() => owner.metadata()).toThrow(/original program cancellation/);
  owner.dispose();
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  expect(new Uint8Array(await fs.readFile(path))).toEqual(body);
});
it('does not restart the capture deadline after complete capability construction', async () => {
  let now = 0,
    hits = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const freeze = Object.freeze;
  vi.spyOn(Object, 'freeze').mockImplementation((value) => {
    const result = freeze(value);
    if (
      result &&
      typeof result === 'object' &&
      Object.hasOwn(result, 'metadata') &&
      Object.hasOwn(result, 'dispose')
    ) {
      hits++;
      now = 21;
    }
    return result;
  });
  await expect(prepareFFmpegExecutable(path, { ...options(), timeoutMs: 20 })).rejects.toThrow(
    /timed out/,
  );
  expect(hits).toBe(1);
});
