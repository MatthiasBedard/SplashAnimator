import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { newProject, type Vector } from '../../packages/document/src';
let bundle = '';
test.beforeAll(async () => {
  const worker = (await fs.readdir('dist/assets')).find(
    (name) => name.startsWith('compile-worker-') && name.endsWith('.js'),
  );
  if (!worker) throw Error('Build production compiler assets first.');
  // Test-only in-memory library bundle; never writes or replaces the running app build.
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'qualified-symbol-worker-test',
        enforce: 'pre',
        transform(source, id) {
          if (id.replaceAll('\\', '/').endsWith('/packages/scripting/src/compile-async.ts')) {
            const revised = source.replace(
              "new URL('./compile-worker.ts',import.meta.url)",
              `new URL('/assets/${worker}',location.href)`,
            );
            if (revised === source) throw Error('Compiler worker harness path changed.');
            return revised;
          }
        },
      },
    ],
    build: {
      write: false,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: path.resolve('packages/scripting/src/symbol-program.ts'),
        name: 'SymbolProgramHarness',
        formats: ['iife'],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result],
    chunks = outputs.flatMap((value) => ('output' in value ? value.output : [])),
    entry = chunks.find((value) => value.type === 'chunk' && value.isEntry);
  if (!entry || entry.type !== 'chunk') throw Error('Missing private program test bundle.');
  bundle = entry.code;
});
function fixture() {
  const project = newProject();
  project.fps = 30;
  project.frameScripts = [{ frame: 40, source: 'throw new Error("main must not run");' }];
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 10,
    rotation: 15,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  project.symbols = [
    {
      id: 'local',
      name: 'Local',
      width: 40,
      height: 30,
      shapes: [
        art,
        {
          ...art,
          id: 'nested',
          kind: 'symbol',
          symbolId: 'child',
          symbolPlayback: { mode: 'movie', firstFrame: 1 },
        },
      ],
      timeline: {
        duration: 3,
        keys: [],
        frameScripts: [
          { frame: 0, source: 'state.n=1; timeline.gotoAndStop(2);' },
          { frame: 2, source: 'state.n=(state.n as number)+1; timeline.stop();' },
        ],
      },
    },
    {
      id: 'child',
      name: 'Child',
      width: 20,
      height: 10,
      shapes: [{ ...art, id: 'child-art' }],
      buttonStates: { up: 0, over: 1, down: 1, hit: 0 },
      timeline: {
        duration: 2,
        keys: [],
        frameScripts: [{ frame: 0, source: 'throw new Error("child must not run");' }],
      },
    },
  ];
  return { project, definition: structuredClone(project.symbols[0]), revision: 2, frame: 1 };
}
test('qualified local program runs only selected bodies with real workers and rejects prior capture checkpoints', async ({
  page,
}) => {
  const workers: { closed: boolean }[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('worker', (worker) => {
    const item = { closed: false };
    workers.push(item);
    worker.on('close', () => (item.closed = true));
  });
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (raw) => {
    const api = Reflect.get(
      window,
      'SymbolProgramHarness',
    ) as typeof import('../../packages/scripting/src/symbol-program');
    const source = { ...raw, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source, 7),
      snapshot = owner.snapshot(),
      preview = (await owner.prepare({ n: 0 })).preview!;
    const initial = preview.checkpoint(),
      framesBefore = document.querySelectorAll('iframe').length;
    const trace = await preview.runWithPresentation(4);
    preview.restore(initial);
    const replay = await preview.runWithPresentation(4);
    const other = api.captureSymbolLocalProgram(() => source, 7),
      foreign = (await other.prepare({ n: 0 })).preview!;
    let foreignError = '';
    try {
      foreign.restore(trace.checkpoint);
    } catch (e) {
      foreignError = String(e);
    }
    owner.dispose();
    other.dispose();
    return {
      snapshot,
      initial,
      trace,
      replay,
      foreignError,
      framesBefore,
      framesAfter: document.querySelectorAll('iframe').length,
      source: source.project,
    };
  }, fixture());
  expect(result.framesBefore).toBe(0);
  expect(result.framesAfter).toBe(0);
  expect(result.snapshot.config).toEqual({ duration: 3, fps: 30, seed: 7 });
  expect(result.snapshot.artwork.symbols.every((s) => s.timeline?.frameScripts === undefined)).toBe(
    true,
  );
  expect(result.snapshot.artwork.definition.shapes).toEqual(fixture().definition.shapes);
  expect(result.trace.checkpoint.session.state).toEqual({ n: 2 });
  expect(result.trace.presentation.map((p) => p.frame)).toEqual([0, 2, 2, 2, 2]);
  expect(result.replay).toEqual(result.trace);
  expect(result.foreignError).toContain('authored source');
  expect(result.source.frameScripts).toEqual(fixture().project.frameScripts);
  await expect.poll(() => workers.filter((w) => !w.closed).length).toBe(0);
  expect(errors).toEqual([]);
});
test('qualified worker results reject late source edits and source getters never dispatch a frame', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (raw) => {
    const api = Reflect.get(
      window,
      'SymbolProgramHarness',
    ) as typeof import('../../packages/scripting/src/symbol-program');
    const source = { ...raw, validateEnclosing: () => {} };
    source.definition.timeline!.frameScripts = [
      {
        frame: 0,
        source: 'const until=Date.now()+80; while(Date.now()<until){} state.n=99; timeline.stop();',
      },
    ];
    const owner = api.captureSymbolLocalProgram(() => source, 7),
      preview = (await owner.prepare({ n: 0 })).preview!,
      before = preview.checkpoint(),
      revision = source.revision;
    let enteredFrames = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLIFrameElement && node.title === 'Isolated script frame')
            enteredFrames++;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let getterError = '';
    try {
      await preview.run(1, {
        events: [
          {
            tick: 0,
            get data() {
              source.revision++;
              return { value: 1 };
            },
          },
        ],
      });
    } catch (e) {
      getterError = String(e);
    }
    source.revision = revision;
    const afterGetter = preview.checkpoint(),
      framesAfterGetter = document.querySelectorAll('iframe').length,
      enteredAfterGetter = enteredFrames;
    const pending = preview.run(1);
    setTimeout(() => source.revision++, 20);
    let lateError = '';
    try {
      await pending;
    } catch (e) {
      lateError = String(e);
    }
    source.revision = revision;
    const after = preview.checkpoint();
    owner.dispose();
    observer.disconnect();
    return {
      before,
      afterGetter,
      framesAfterGetter,
      enteredAfterGetter,
      enteredFrames,
      getterError,
      lateError,
      after,
      framesAfter: document.querySelectorAll('iframe').length,
    };
  }, fixture());
  expect(result.getterError).toContain('changed');
  expect(result.afterGetter).toEqual(result.before);
  expect(result.framesAfterGetter).toBe(0);
  expect(result.enteredAfterGetter).toBe(0);
  expect(result.enteredFrames).toBe(1);
  expect(result.lateError).toContain('changed');
  expect(result.after).toEqual(result.before);
  expect(result.framesAfter).toBe(0);
  expect(errors).toEqual([]);
});
