import { afterEach, expect, it, vi } from 'vitest';
import { newProject, symbolLayers, validateProject, type SymbolDefinition, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createSymbolSampledSelectionContext,
  captureSymbolSampledSelectionContext,
  prepareSymbolSampledSelectionTranslation,
  admitSymbolSampledSelectionPublication,
  type SymbolSampledSelectionState,
} from '../apps/editor/src/symbol-sampled-selection-editor';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const project = newProject(); project.duration = 14;
  const ink = (id: string, x: number, groups?: string[]): Vector => ({
    id, kind: 'rectangle', x, y: 10, width: 12, height: 12, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [], ...(groups ? { groups } : {}),
  });
  project.layers = ['@base', 'extra'].map((id, i) => ({
    id, name: id, visible: true, locked: false,
    keys: [
      { frame: 0, shapes: [ink('r', 0), ink('a', 20, ['outer', 'inner']), ink('b', 40, ['outer']), ink('other', 100)] },
      { frame: i ? 10 : 8, shapes: [ink('r', 80), ink('a', 100, ['outer', 'inner']), ink('b', 120, ['outer']), ink('other', 180)] },
      { frame: 12, shapes: [] },
    ],
  }));
  createBasicMotionSpan(project, ['@base'], 0, 8, 'linear');
  createBasicMotionSpan(project, ['extra'], 0, 10, 'linear');
  const base = project.layers[0];
  const definition: SymbolDefinition = {
    id: 'sprite', name: 'Sprite', width: 400, height: 240,
    shapes: base.keys[0].shapes,
    timeline: { duration: 14, keys: base.keys.slice(1), motionSpans: base.motionSpans, layers: [project.layers[1]] },
  };
  const state: SymbolSampledSelectionState = {
    definition, symbols: [definition], assets: [], revision: 3, frame: 4,
    policy: 0, groups: false, pick: null, prepared: null, blocked: false,
  };
  let enclosing = true, candidateAdmission = true;
  const validateEnclosing = vi.fn(() => { if (!enclosing) throw Error('enclosing changed'); });
  const validateCandidate = vi.fn((candidate: SymbolDefinition) => {
    if (!candidateAdmission) throw Error('candidate rejected');
    validateProject({ ...project, layers: symbolLayers(candidate), assets: state.assets, symbols: state.symbols.map(s => s.id === candidate.id ? candidate : s) });
  });
  const make = () => createSymbolSampledSelectionContext(() => state, validateEnclosing, validateCandidate, (candidate, frame) => ({ candidate, frame }))!;
  return { state, context: make(), make, validateEnclosing, validateCandidate,
    rejectEnclosing: (value = false) => { enclosing = value; }, rejectCandidate: (value = false) => { candidateAdmission = value; } };
}
const requests = [{ layerId: 'extra', shapeId: 'b' }, { layerId: '@base', shapeId: 'r' }];
const offset = { x: 5, y: 4 };

it('prepares original complete units across differing spans without draft/history writes', () => {
  const { state, context } = fixture(), before = structuredClone(state);
  const edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
  expect(edit.owner.definitionId).toBe('sprite');
  expect(edit.owner.tracks.map(t => [t.layerId, t.shapeIds])).toEqual([['@base', ['r']], ['extra', ['a', 'b']]]);
  const layers = symbolLayers(edit.candidate), base = layers[0].keys.find(k => k.frame === 4)!, extra = layers[1].keys.find(k => k.frame === 4)!;
  expect(base.shapes.map(s => [s.x, s.y])).toEqual([[45, 14], [60, 10], [80, 10], [140, 10]]);
  expect(extra.shapes.map(s => [s.x, s.y])).toEqual([[32, 10], [57, 14], [77, 14], [132, 10]]);
  for (let i = 0; i < layers.length; i++) {
    expect(layers[i].keys.find(k => k.frame === 0)).toEqual(symbolLayers(before.definition)[i].keys[0]);
    expect(layers[i].keys.find(k => k.frame === (i ? 10 : 8))).toEqual(symbolLayers(before.definition)[i].keys.find(k => k.frame === (i ? 10 : 8)));
    expect(layers[i].keys.find(k => k.frame === 12)).toEqual({ frame: 12, shapes: [] });
    expect(layers[i].drawingMode).toBeUndefined();
  }
  admitSymbolSampledSelectionPublication(edit); expect(state).toEqual(before); expect(edit.snapshot).toEqual(before.definition);
});
it('snapshots caller identities and document targets once', () => {
  const { context } = fixture(), reads = { layer: 0, id: 0, x: 0, y: 0 };
  prepareSymbolSampledSelectionTranslation(context, [{ get layerId() { reads.layer++; return '@base'; }, get shapeId() { reads.id++; return 'r'; } }], { get x() { reads.x++; return 5; }, get y() { reads.y++; return 4; } }, () => {});
  expect(reads).toEqual({ layer: 1, id: 1, x: 1, y: 1 });
});
for (const field of ['definition', 'symbols', 'assets', 'revision', 'frame', 'policy', 'groups', 'pick', 'prepared', 'blocked'] as const)
  it('rejects changed original isolated context: ' + field, () => {
    const { state, context } = fixture(), edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
    if (field === 'definition' || field === 'symbols' || field === 'assets') state[field] = structuredClone(state[field]) as never;
    if (field === 'revision' || field === 'frame' || field === 'policy') state[field]++;
    if (field === 'groups' || field === 'blocked') state[field] = true;
    if (field === 'pick' || field === 'prepared') state[field] = {};
    expect(() => admitSymbolSampledSelectionPublication(edit)).toThrow(/context changed/);
  });
for (const field of ['definition', 'symbols', 'assets'] as const)
  it('rejects in-place original content changes: ' + field, () => {
    const { state, context } = fixture(), edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
    if (field === 'definition') state.definition.name = 'Changed';
    if (field === 'symbols') state.symbols.push({ id: 'child', name: 'Child', width: 1, height: 1, shapes: [] });
    if (field === 'assets') state.assets.push({ id: 'asset' } as never);
    expect(() => edit.validate()).toThrow(/source changed/);
  });
it('blocks unavailable context without invoking enclosing admission', () => {
  const { state } = fixture(); state.blocked = true; const enclosing = vi.fn();
  expect(createSymbolSampledSelectionContext(() => state, enclosing, () => {}, () => null)).toBeNull(); expect(enclosing).not.toHaveBeenCalled();
});
it('keeps frozen enclosing admission and permits fresh source-valid retries', () => {
  const f = fixture(), before = structuredClone(f.state), edit = prepareSymbolSampledSelectionTranslation(f.context, requests, offset, () => {});
  f.rejectEnclosing(); expect(() => edit.validate()).toThrow(/enclosing changed/); f.rejectEnclosing(true);
  admitSymbolSampledSelectionPublication(prepareSymbolSampledSelectionTranslation(f.context, requests, offset, () => {})); expect(f.state).toEqual(before);
});
it('rejects changed-and-restored inputs and permits a fresh original-source command', () => {
  const { context } = fixture(); let revision = 0;
  const prepare = () => { const at = revision; return prepareSymbolSampledSelectionTranslation(context, requests, offset, () => { if (at !== revision) throw Error('input changed'); }); };
  const edit = prepare(); revision += 2; expect(() => edit.validate()).toThrow(/input changed/); admitSymbolSampledSelectionPublication(prepare());
});
it('rejects a source mutation from a raw numeric getter before local preparation', () => {
  const { state, context } = fixture();
  expect(() => prepareSymbolSampledSelectionTranslation(context, requests, { get x() { state.definition.name = 'Changed'; return 5; }, y: 4 }, () => {})).toThrow(/source changed/);
  expect(symbolLayers(state.definition).every(l => l.motionSpans?.length === 1)).toBe(true);
});
it('rejects source mutation after the complete edited definition is cloned', () => {
  const { state, context } = fixture(), clone = structuredClone; let completed = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value); const candidate = value as SymbolDefinition;
    if (candidate?.id === 'sprite' && candidate.timeline && symbolLayers(candidate).every(l => l.motionSpans?.length === 2)) { completed = true; state.definition.name = 'Late edit'; }
    return out;
  }) as typeof structuredClone);
  expect(() => prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {})).toThrow(/source changed/); expect(completed).toBe(true);
});
it('repeats final complete enclosing candidate admission without writing source', () => {
  const f = fixture(), before = structuredClone(f.state), edit = prepareSymbolSampledSelectionTranslation(f.context, requests, offset, () => {});
  f.rejectCandidate(); expect(() => edit.validate()).toThrow(/candidate rejected/); expect(f.state).toEqual(before);
  f.rejectCandidate(true); admitSymbolSampledSelectionPublication(edit);
});
for (const change of ['source', 'input', 'candidate'] as const)
  it('rejects actual late complete-candidate validation changes: ' + change, () => {
    const f = fixture(); let armed = false, revision = 0, completed = false;
    const context = createSymbolSampledSelectionContext(() => f.state, f.validateEnclosing, candidate => {
      f.validateCandidate(candidate);
      if (armed) { completed = true; if (change === 'source') f.state.definition.name = 'Late source'; else if (change === 'input') revision++; else candidate.name = 'Forged'; }
    }, () => null)!;
    const edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => { if (revision) throw Error('late input'); });
    armed = true; expect(() => edit.validate()).toThrow(); expect(completed).toBe(true);
  });
it('rejects post-preparation candidate edits even when still a valid symbol definition', () => {
  const { context, validateCandidate } = fixture(), edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
  edit.candidate.name = 'Forged'; validateCandidate(edit.candidate); expect(() => edit.validate()).toThrow(/candidate changed/);
});
it('checks input ownership after final source reads', () => {
  const { context } = fixture(); let armed = false, reads = 0, revision = 0;
  const wrapped = { ...context, validate() { context.validate(); if (armed && ++reads === 2) revision++; } };
  const edit = prepareSymbolSampledSelectionTranslation(wrapped, requests, offset, () => { if (revision) throw Error('late input'); });
  armed = true; expect(() => edit.validate()).toThrow(/late input/); expect(reads).toBe(2);
});
it('samples prepared children through the owned original frame and checks source after rendering', () => {
  const f = fixture(); let armed = false;
  const context = createSymbolSampledSelectionContext(() => f.state, f.validateEnclosing, f.validateCandidate, (candidate, frame) => {
    if (armed) f.state.definition.name = 'Late render source'; return { candidate, frame, prepared: f.state.prepared };
  })!;
  const edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
  expect(context.sample(edit.candidate)).toEqual({ candidate: edit.candidate, frame: 4, prepared: null });
  armed = true; expect(() => context.sample(edit.candidate)).toThrow(/source changed/);
});
it('rejects swallowed enclosing reentry and invalidates that context', () => {
  const f = fixture(); let armed = false;
  const context: ReturnType<typeof f.make> = createSymbolSampledSelectionContext(() => f.state, () => { if (armed) { try { context.validate(); } catch { /* hostile callback */ } } }, f.validateCandidate, (candidate, frame) => ({ candidate, frame }))!;
  armed = true; expect(() => context.validate()).toThrow(/reentered/); armed = false; expect(() => context.validate()).toThrow(/invalidated/);
});
for (const kind of ['enclosing', 'candidate', 'input'] as const)
  it('rejects asynchronous admission callbacks: ' + kind, () => {
    const f = fixture();
    if (kind === 'enclosing') expect(() => createSymbolSampledSelectionContext(() => f.state, (() => Promise.resolve()) as never, f.validateCandidate, () => null)).toThrow(/synchronous/);
    else {
      const context = createSymbolSampledSelectionContext(() => f.state, f.validateEnclosing, kind === 'candidate' ? (() => Promise.resolve()) as never : f.validateCandidate, () => null)!;
      expect(() => prepareSymbolSampledSelectionTranslation(context, requests, offset, kind === 'input' ? (() => Promise.resolve()) as never : () => {})).toThrow(/synchronous/);
    }
  });
for (const bad of [NaN, Infinity, -Infinity]) it('rejects nonfinite raw targets '+bad, () => {
  const { state, context } = fixture(), before = structuredClone(state);
  expect(() => prepareSymbolSampledSelectionTranslation(context, requests, { x: bad, y: 1 }, () => {})).toThrow(); expect(state).toEqual(before);
});
it('exposes detached original choices and disposes temporary captures explicitly', () => {
  const { context } = fixture(), { capture, active } = captureSymbolSampledSelectionContext(context);
  const choices = capture.choices; choices[0].shapeId = 'forged'; expect(capture.choices[0].shapeId).toBe('r'); active(); capture.dispose(); expect(() => capture.choices).toThrow(/disposed/);
});
for (const phase of ['preparation', 'publication', 'presentation'] as const)
  it('rejects swallowed preparation reentry during '+phase, () => {
    const f = fixture(); let armed = false, attempted = false;
    const reenter = () => { if (armed) { attempted = true; try { prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {}); } catch { /* hostile callback */ } } };
    const context: ReturnType<typeof f.make> = createSymbolSampledSelectionContext(() => f.state, f.validateEnclosing, candidate => {
      f.validateCandidate(candidate); if (phase !== 'presentation') reenter();
    }, (candidate, frame) => { if (phase === 'presentation') reenter(); return { candidate, frame }; })!;
    const edit = phase === 'preparation' ? null : prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
    armed = true;
    expect(() => phase === 'preparation' ? prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {}) : phase === 'publication' ? edit!.validate() : context.sample(edit!.candidate)).toThrow(/invalidated/);
    expect(attempted).toBe(true);
    armed = false; expect(() => context.validate()).toThrow(/invalidated/);
    admitSymbolSampledSelectionPublication(prepareSymbolSampledSelectionTranslation(f.make(), requests, offset, () => {}));
  });
for (const kind of ['zero', 'overflow', 'empty', 'duplicate', 'missing', 'not-array'] as const)
  it('rejects invalid commands atomically before enclosing candidate admission: '+kind, () => {
    const f = fixture(), before = structuredClone(f.state);
    const input = kind === 'empty' ? [] : kind === 'duplicate' ? [requests[0], requests[0]] : kind === 'missing' ? [{ layerId: 'extra', shapeId: 'missing' }] : kind === 'not-array' ? { 0: requests[0], length: 1 } as never : requests;
    const target = kind === 'zero' ? { x: 0, y: 0 } : kind === 'overflow' ? { x: Number.MAX_VALUE, y: Number.MAX_VALUE } : offset;
    expect(() => prepareSymbolSampledSelectionTranslation(f.context, input, target, () => {})).toThrow();
    expect(f.validateCandidate).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
  });
for (const field of ['assets', 'symbols'] as const)
  it('requires actual original complete metadata arrays: '+field, () => {
    const f = fixture(); f.state[field] = undefined as never;
    const context = f.make(); expect(() => prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {})).toThrow(/library\/assets/);
  });
it('rejects raw original nonfinite values before cloning can conceal them', () => {
  const f = fixture(); f.state.definition.shapes[0].x = NaN;
  expect(() => prepareSymbolSampledSelectionTranslation(f.make(), requests, offset, () => {})).toThrow(/nonfinite/);
  expect(Number.isNaN(f.state.definition.shapes[0].x)).toBe(true); expect(f.validateCandidate).not.toHaveBeenCalled();
});
it('returns detached snapshots and supports JSON reopen at a later original frame', () => {
  const f = fixture(), before = structuredClone(f.state.definition);
  const edit = prepareSymbolSampledSelectionTranslation(f.context, requests, offset, () => {});
  edit.snapshot.name = 'Detached snapshot'; expect(f.state.definition).toEqual(before);
  f.state.definition = JSON.parse(JSON.stringify(edit.candidate)); f.state.symbols = [f.state.definition]; f.state.revision++; f.state.frame = 6;
  const reopened = structuredClone(f.state.definition), later = prepareSymbolSampledSelectionTranslation(f.make(), requests, { x: -3, y: 2 }, () => {});
  admitSymbolSampledSelectionPublication(later); expect(later.owner.frame).toBe(6);
  expect(symbolLayers(later.candidate).every(l => l.motionSpans?.length === 3)).toBe(true); expect(f.state.definition).toEqual(reopened);
});
it('rejects forged returned membership before it can own authored selection/readout', () => {
  const { context } = fixture(), edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
  edit.owner.tracks[0].shapeIds.push('other'); expect(() => edit.validate()).toThrow(/owner changed/);
});
it('rejects late public membership changes from complete candidate admission', () => {
  const f = fixture(), mutate = vi.fn();
  const context = createSymbolSampledSelectionContext(() => f.state, f.validateEnclosing, candidate => {
    f.validateCandidate(candidate); mutate();
  }, () => null)!;
  const edit = prepareSymbolSampledSelectionTranslation(context, requests, offset, () => {});
  mutate.mockImplementation(() => { edit.owner.tracks[0].shapeIds.push('other'); });
  expect(() => edit.validate()).toThrow(/owner changed/);
});
