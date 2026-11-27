import { afterEach, expect, it, vi } from 'vitest';
import es5 from 'typescript/lib/lib.es5.d.ts?raw';
import { createFrameLanguageService } from '../packages/scripting/src/language-service';
import { compileFrameSource } from '../packages/scripting/src/compile';
import { createSourceLanguageClient } from '../apps/editor/src/source-language-client';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('completes only actual timeline capabilities without running source', () => {
  const service = createFrameLanguageService(es5),
    source = 'throw Error("must not run");\ntimeline.';
  const result = service.request({ kind: 'complete', source, offset: source.length });
  expect(result.kind).toBe('complete');
  if (result.kind !== 'complete') throw Error('Missing completions');
  expect(result.items.map((i) => i.label).sort()).toEqual(
    [
      'currentFrame',
      'fps',
      'gotoAndPlay',
      'gotoAndStop',
      'play',
      'playing',
      'stop',
      'totalFrames',
    ].sort(),
  );
  expect(() =>
    service.request({ kind: 'diagnostics', source: 'throw Error("must not run");' }),
  ).not.toThrow();
  service.dispose();
  expect(() => service.request({ kind: 'complete', source, offset: source.length })).toThrow(
    'closed',
  );
});
it('completes the runtime helper', () => {
  const service = createFrameLanguageService(es5);
  const source = 'runtime.';
  const reply = service.request({ kind: 'complete', source, offset: source.length });
  expect(reply.kind === 'complete' && reply.items.map(item => item.label)).toEqual(['random']);
  service.dispose();
});
it('completes the renamed stage capability', () => {
  const service = createFrameLanguageService(es5);
  const source = 'stage?.';
  const reply = service.request({ kind: 'complete', source, offset: source.length });
  expect(reply.kind === 'complete' && reply.items.map(item => item.label)).toEqual(
    expect.arrayContaining(['getInstance', 'library', 'setTransform', 'width']),
  );
  service.dispose();
});
it('uses shared readonly timeline and input declarations for hover and exact diagnostic maps', () => {
  const service = createFrameLanguageService(es5),
    source = 'const emoji="😀";\r\nconst frame = timeline.currentFrame;';
  const hover = service.request({
    kind: 'hover',
    source,
    offset: source.indexOf('currentFrame') + 2,
  });
  expect(hover.kind === 'hover' && hover.text).toContain('number');
  for (const code of [
    source,
    'timeline.currentFrame=2;',
    'input.x=1;',
    'timeline.gotoAndStop(false);',
    'document.title="no";',
    'import("x");',
    'const n: = 2;',
  ]) {
    const reply = service.request({ kind: 'diagnostics', source: code });
    expect(reply.kind === 'diagnostics' && reply.diagnostics).toEqual(
      compileFrameSource(code, es5).diagnostics,
    );
  }
  service.dispose();
});
it('refreshes independent source versions and never resolves external references', () => {
  const service = createFrameLanguageService(es5);
  for (const name of ['first', 'second']) {
    const source = `/// <reference path="outside.d.ts" />\nconst value={${name}:1};value.`;
    const reply = service.request({ kind: 'complete', source, offset: source.length });
    expect(reply.kind === 'complete' && reply.items.map((i) => i.label)).toEqual([name]);
  }
  const reply = service.request({
    kind: 'diagnostics',
    source: '/// <reference path="outside.d.ts" />\nconst x: ExternalSecret=1;',
  });
  expect(
    reply.kind === 'diagnostics' &&
      reply.diagnostics.some((d) => d.message.includes('ExternalSecret')),
  ).toBe(true);
  service.dispose();
});
for (const request of [
  { kind: 'bad', source: '' },
  { kind: 'complete', source: 'x', offset: NaN },
  { kind: 'hover', source: 'x', offset: 2 },
  { kind: 'hover', source: 'x', offset: -1 },
  { kind: 'complete', source: 'x', offset: 0.5 },
  { kind: 'diagnostics', source: 'x'.repeat(256 * 1024 + 1) },
])
  it('rejects malformed or oversized language requests without poisoning a valid service', () => {
    const service = createFrameLanguageService(es5);
    expect(() => service.request(request as never)).toThrow();
    expect(service.request({ kind: 'diagnostics', source: 'timeline.stop();' })).toEqual({
      kind: 'diagnostics',
      diagnostics: [],
    });
    service.dispose();
  });
function workers() {
  const all: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    messages: { id: number; request: unknown }[] = [];
    terminated = false;
    constructor() {
      all.push(this);
    }
    postMessage(message: { id: number; request: unknown }) {
      this.messages.push(structuredClone(message));
    }
    terminate() {
      this.terminated = true;
    }
    reply(result: unknown, id = this.messages.at(-1)!.id) {
      this.onmessage?.({ data: { id, result } } as MessageEvent);
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return { all };
}
it('owns detached requests, rejects cancelled replies and recreates after cancellation', async () => {
  const { all } = workers(),
    client = createSourceLanguageClient(),
    request = { kind: 'hover' as const, source: 'timeline.stop', offset: 3 };
  const first = client.request(request);
  request.source = 'changed';
  expect(all[0].messages[0].request).toEqual({ kind: 'hover', source: 'timeline.stop', offset: 3 });
  const rejected = expect(first).rejects.toThrow('cancelled');
  client.cancel();
  await rejected;
  expect(all[0].terminated).toBe(true);
  const second = client.request({ kind: 'diagnostics', source: '' });
  all[0].reply({ kind: 'hover', text: 'stale' });
  all[1].reply({ kind: 'diagnostics', diagnostics: [] });
  expect(await second).toEqual({ kind: 'diagnostics', diagnostics: [] });
  client.dispose();
  expect(all[1].terminated).toBe(true);
  await expect(client.request({ kind: 'diagnostics', source: '' })).rejects.toThrow('closed');
});
it('times out and terminates every pending job, then permits a fresh retry', async () => {
  vi.useFakeTimers();
  const { all } = workers(),
    client = createSourceLanguageClient();
  const a = client.request({ kind: 'hover', source: 'x', offset: 0 }),
    b = client.request({ kind: 'diagnostics', source: 'x' });
  const rejected = Promise.all([
    expect(a).rejects.toThrow('timed out'),
    expect(b).rejects.toThrow('timed out'),
  ]);
  await vi.advanceTimersByTimeAsync(4000);
  await rejected;
  expect(all[0].terminated).toBe(true);
  const next = client.request({ kind: 'hover', source: 'x', offset: 0 });
  all[1].reply({ kind: 'hover', text: 'number' });
  expect(await next).toEqual({ kind: 'hover', text: 'number' });
  client.dispose();
});
for (const result of [
  { kind: 'complete', items: [] },
  { kind: 'diagnostics', diagnostics: [] },
  { kind: 'hover', text: 'x'.repeat(2001) },
  { kind: 'hover', text: 1 },
  null,
])
  it('rejects malformed or wrong-kind worker responses without authoring source', async () => {
    const { all } = workers(),
      client = createSourceLanguageClient();
    const task = client.request({ kind: 'hover', source: 'x', offset: 0 });
    all[0].reply(result);
    await expect(task).rejects.toThrow('Invalid source language response');
    client.dispose();
  });
it('admits exactly eight pending jobs and validates before starting a worker', async () => {
  const { all } = workers(),
    client = createSourceLanguageClient();
  await expect(client.request({ kind: 'hover', source: 'x', offset: NaN })).rejects.toThrow(
    'Invalid',
  );
  expect(all).toHaveLength(0);
  const tasks = Array.from({ length: 8 }, () =>
    client.request({ kind: 'diagnostics', source: '' }),
  );
  await expect(client.request({ kind: 'diagnostics', source: '' })).rejects.toThrow('busy');
  const rejected = Promise.all(tasks.map((task) => expect(task).rejects.toThrow('cancelled')));
  client.dispose();
  await rejected;
  expect(all[0].terminated).toBe(true);
});
it('cleans worker construction failure and allows a source-valid retry', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw Error('creation failed');
      }
    },
  );
  const client = createSourceLanguageClient();
  await expect(client.request({ kind: 'diagnostics', source: '' })).rejects.toThrow(
    'creation failed',
  );
  const { all } = workers(),
    task = client.request({ kind: 'diagnostics', source: '' });
  all[0].reply({ kind: 'diagnostics', diagnostics: [] });
  await expect(task).resolves.toEqual({ kind: 'diagnostics', diagnostics: [] });
  client.dispose();
});

it('preserves exact source byte admission without evaluating or truncating drafts', () => {
  const service = createFrameLanguageService(es5);
  expect(service.request({ kind: 'diagnostics', source: ' '.repeat(256 * 1024) })).toEqual({
    kind: 'diagnostics',
    diagnostics: [],
  });
  expect(() => service.request({ kind: 'diagnostics', source: 'é'.repeat(131073) })).toThrow(
    'Invalid source language request',
  );
  service.dispose();
});

it('terminates a worker created during synchronous close reentry', async () => {
  let terminated = false;
  const client = createSourceLanguageClient();
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        client.dispose();
      }
      terminate() {
        terminated = true;
      }
      postMessage() {
        throw Error('must not post');
      }
    },
  );
  await expect(client.request({ kind: 'diagnostics', source: '' })).rejects.toThrow('cancelled');
  expect(terminated).toBe(true);
});

it('ignores foreign reply ids and rejects disposed client getter failures before worker construction', async () => {
  const { all } = workers(),
    client = createSourceLanguageClient(),
    task = client.request({ kind: 'hover', source: 'x', offset: 0 });
  all[0].reply({ kind: 'hover', text: 'foreign' }, 999);
  all[0].reply({ kind: 'hover', text: 'owned' });
  expect(await task).toEqual({ kind: 'hover', text: 'owned' });
  client.dispose();
  await expect(
    client.request(
      Object.defineProperty({ kind: 'diagnostics', source: '' }, 'source', {
        get() {
          throw Error('must not read');
        },
      }) as never,
    ),
  ).rejects.toThrow('closed');
});

it('bounds completions while retaining a specifically typed member beyond the first hundred', () => {
  const service = createFrameLanguageService(es5),
    head =
      'const value={' +
      Array.from({ length: 200 }, (_, i) => 'property' + i + ':1').join(',') +
      '};value.';
  const broad = service.request({ kind: 'complete', source: head, offset: head.length });
  expect(broad.kind === 'complete' && broad.items.length).toBe(100);
  const source = head + 'property199',
    narrow = service.request({ kind: 'complete', source, offset: source.length });
  expect(narrow.kind === 'complete' && narrow.items[0].label).toBe('property199');
  service.dispose();
});
it('rejects unused nonfinite diagnostic offsets before worker construction and before engine work', async () => {
  const service = createFrameLanguageService(es5);
  expect(() => service.request({ kind: 'diagnostics', source: '', offset: NaN })).toThrow(
    'position',
  );
  service.dispose();
  const { all } = workers(),
    client = createSourceLanguageClient();
  await expect(client.request({ kind: 'diagnostics', source: '', offset: NaN })).rejects.toThrow(
    'Invalid',
  );
  expect(all).toHaveLength(0);
  client.dispose();
});
