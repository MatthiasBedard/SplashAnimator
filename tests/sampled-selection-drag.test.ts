import { afterEach, expect, it, vi } from 'vitest';
import { newProject, keyAt, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { admitSampledSelectionPublication, createSampledSelectionContext, type SampledSelectionPreview } from '../apps/editor/src/sampled-selection-editor';
import { createSampledSelectionDrag, type SelectionDragState } from '../apps/editor/src/sampled-selection-drag';

afterEach(() => vi.unstubAllGlobals());
function pointer(type: string, x: number, y: number, fields = {}) {
  return Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, pointerType: 'mouse', shiftKey: false, ...fields });
}
function fixture() {
  const project = newProject(); project.duration = 14;
  const ink = (id: string, x: number, y: number, groups?: string[]): Vector => ({ id, kind: 'rectangle', x, y, width: 12, height: 12, rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [], ...(groups ? { groups } : {}) });
  project.layers = ['base', 'extra'].map((id, i) => ({ id, name: id, visible: true, locked: false, drawingMode: 'object', keys: [
    { frame: 0, shapes: [ink('r', 0, i ? 100 : 10), ink('b', 20, i ? 100 : 10, ['outer']), ink('a', 40, i ? 100 : 10, ['outer']), ink('other', 150, i ? 100 : 10)] },
    { frame: i ? 10 : 8, shapes: [ink('r', 80, i ? 100 : 10), ink('b', 100, i ? 100 : 10, ['outer']), ink('a', 120, i ? 100 : 10, ['outer']), ink('other', 230, i ? 100 : 10)] },
  ] }));
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear'); createBasicMotionSpan(project, ['extra'], 0, 10, 'linear');
  const source = { project, signature: JSON.stringify(project), frame: 4, revision: 1, policy: 0, groups: false, pick: null, children: false, prepared: null, stamp: 'original', blocked: false };
  const view = { origin: { x: 0, y: 0 }, zoom: 1, width: 400, height: 240 };
  const win = new EventTarget(); vi.stubGlobal('window', win);
  const observers: { callback: () => void; connected: boolean }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    item: typeof observers[number]; constructor(callback: () => void) { this.item = { callback, connected: false }; observers.push(this.item); }
    observe() { this.item.connected = true; } disconnect() { this.item.connected = false; }
  });
  const captures = new Set<number>(), events: string[] = [];
  const nativeCanvas = new EventTarget();
  const canvas = Object.assign(nativeCanvas, {
    rect: { left: 10, top: 20, width: 400, height: 240 },
    getBoundingClientRect() { return this.rect; }, focus() {},
    hasPointerCapture: (id: number) => captures.has(id),
    setPointerCapture(id: number) { captures.add(id); events.push('capture'); },
    releasePointerCapture(id: number) { captures.delete(id); events.push('release'); nativeCanvas.dispatchEvent(pointer('lostpointercapture', 0, 0, { pointerId: id })); },
  });
  const sample = vi.fn((candidate: typeof project) => {
    events.push('sample:' + captures.size);
    return { scene: candidate.layers.map(l => ({ layerId: l.id, key: keyAt(l, 4), sampled: true })), rendered: candidate.layers.flatMap(l => keyAt(l, 4).shapes) };
  });
  const context = createSampledSelectionContext(() => source, p => structuredClone(p), sample)!;
  const state: SelectionDragState = { context, requests: [{ layerId: 'base', shapeId: 'r' }, { layerId: 'extra', shapeId: 'a' }], revision: 0, policy: 0, enabled: true, x: 0, y: 0, preview: null };
  const frames = new Map<number, () => void>(), callbacks: (() => void)[] = []; let next = 0, active = false;
  const published: typeof project[]=[];const publish=vi.fn((edit: Parameters<typeof admitSampledSelectionPublication>[0])=>{admitSampledSelectionPublication(edit);structuredClone(project);edit.validate();published.push(edit.candidate);});
  const error = vi.fn();
  const control = createSampledSelectionDrag({ canvas: canvas as unknown as HTMLCanvasElement, view: () => view, state: () => state,
    draft: (x, y) => { state.x = x; state.y = y; }, preview: value => { state.preview = value; }, active: value => { active = value; }, publish,error,
    requestFrame: callback => { const id = ++next; callbacks.push(callback); frames.set(id, callback); return id; }, cancelFrame: id => { frames.delete(id); },
  });
  const screen = (x: number, y: number) => ({ x: canvas.rect.left + (x * view.zoom + view.origin.x) * canvas.rect.width / view.width, y: canvas.rect.top + (y * view.zoom + view.origin.y) * canvas.rect.height / view.height });
  const dispatch = (type: string, dx = 0, dy = 0, fields = {}) => { const start = screen(46, 16); canvas.dispatchEvent(pointer(type, start.x + dx, start.y + dy, fields)); };
  const flush = () => { const work = [...frames.values()]; frames.clear(); work.forEach(cb => cb()); };
  return { source, project, context, view, win, canvas, captures, observers, events, state, frames, callbacks, sample, error, control, published,publish, screen, dispatch, flush, active: () => active };
}

it('coalesces scratch poses, retains original geometry/history and freshly prepares after cleanup', () => {
  const f = fixture(), before = structuredClone(f.project);
  f.dispatch('pointerdown'); f.dispatch('pointermove', 3, 2); f.dispatch('pointermove', 10, 6);
  expect([f.state.x, f.state.y]).toEqual([10, 6]); expect(f.frames.size).toBe(1); expect(f.sample).not.toHaveBeenCalled();
  f.flush(); expect(f.sample).toHaveBeenCalledTimes(1); expect(f.state.preview!.pose.rendered.filter(s => s.id === 'r').map(s => s.x)).toEqual([50, 32]);
  f.dispatch('pointermove', 15, 7); expect(f.frames.size).toBe(1); expect(() => f.state.preview!.validate()).not.toThrow();
  f.dispatch('pointerup', 20, 8); expect(f.frames.size).toBe(0); expect(f.sample).toHaveBeenCalledTimes(2);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']); expect(f.captures.size).toBe(0); expect(f.observers.every(o => !o.connected)).toBe(true);
  expect([f.state.x, f.state.y]).toEqual([20, 8]); expect(f.state.preview!.pose.rendered.find(s => s.id === 'r')!.x).toBe(60);
  expect(f.project).toEqual(before); expect(() => f.state.preview!.validate()).not.toThrow();
  f.callbacks.forEach(cb => cb()); expect(f.sample).toHaveBeenCalledTimes(2); f.control.dispose();
});
it('uses independent CSS scales, a frozen pointer offset and document-axis Shift precedence', () => {
  const f = fixture(); f.canvas.rect.width = 800; f.canvas.rect.height = 120; f.view.origin = { x: 17, y: 29 }; f.view.zoom = 2;
  f.dispatch('pointerdown'); f.dispatch('pointermove', 40, 12, { shiftKey: true });
  // x=40*400/800/2=10, y=12*240/120/2=12: Y wins in document space.
  expect([f.state.x, f.state.y]).toEqual([0, 12]); f.dispatch('pointerup', 40, 12, { shiftKey: true });
  expect([f.state.x, f.state.y]).toEqual([0, 12]); expect(f.error).not.toHaveBeenCalled(); f.control.dispose();
});
it('allows any privately owned member of a complete original group to start capture', () => {
  const f = fixture(), point = f.screen(78, 106);
  f.canvas.dispatchEvent(pointer('pointerdown', point.x, point.y)); expect(f.captures.has(1)).toBe(true);
  f.canvas.dispatchEvent(pointer('pointerup', point.x + 9, point.y + 4)); expect(f.state.preview!.owner.tracks.map(t => t.shapeIds)).toEqual([['r'], ['b', 'a']]); f.control.dispose();
});
it('keeps detached selected IDs private rather than following later public request mutations', () => {
  const f = fixture(); f.dispatch('pointerdown'); (f.state.requests[0] as { shapeId: string }).shapeId = 'other';
  f.dispatch('pointerup', 8, 4); expect(f.state.preview!.owner.tracks[0].shapeIds).toEqual(['r']); expect(f.state.preview!.pose.rendered.find(s => s.id === 'other')!.x).toBe(190); f.control.dispose();
});
for (const kind of ['unselected', 'locked', 'transparent'] as const) it('uses actual original foreground ownership: ' + kind, () => {
  const f = fixture(); f.control.dispose();
  const front = { ...structuredClone(f.project.layers[0]), id: 'front', locked: kind === 'locked', motionSpans: undefined, keys: [{ frame: 0, shapes: [{ ...f.project.layers[0].keys[4].shapes[0], id: 'front', ...(kind === 'transparent' ? { opacity: 0 } : {}) }] }] };
  f.project.layers.push(front); f.source.signature = JSON.stringify(f.project);
  // Reopening the fixture through a fresh context is required after source edits.
  const context = createSampledSelectionContext(() => f.source, p => structuredClone(p), f.sample)!; f.state.context = context;
  const control = createSampledSelectionDrag({ canvas: f.canvas as unknown as HTMLCanvasElement, view: () => f.view, state: () => f.state, draft: (x, y) => { f.state.x = x; f.state.y = y; }, preview: p => { f.state.preview = p; }, active: () => {}, error: f.error, requestFrame: () => 1, cancelFrame: () => {} });
  f.dispatch('pointerdown'); expect(f.captures.has(1)).toBe(kind === 'transparent'); control.dispose();
});
for (const reason of ['escape', 'pointercancel', 'lost', 'blur', 'canvas-blur', 'resize', 'scroll'] as const) it('cleans native state and restores a valid numeric preview after ' + reason, () => {
  const f = fixture(); f.state.x = 7; f.state.y = 9;
  const prior = { context: f.context, owner: {} as never, pose: { scene: [], rendered: [] }, validate: () => { if (f.state.x !== 7 || f.state.y !== 9) throw Error('prior targets'); }, discard() {} }; f.state.preview = prior;
  f.dispatch('pointerdown'); f.dispatch('pointermove', 12, 6); f.flush();
  if (reason === 'escape') f.win.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
  else if (reason === 'pointercancel') f.dispatch('pointercancel');
  else if (reason === 'lost') f.canvas.releasePointerCapture(1);
  else if (reason === 'canvas-blur') f.canvas.dispatchEvent(new Event('blur'));
  else f.win.dispatchEvent(new Event(reason));
  expect([f.state.x, f.state.y]).toEqual([7, 9]); expect(f.state.preview).toBe(prior); expect(f.active()).toBe(false); expect(f.captures.size).toBe(0); expect(f.frames.size).toBe(0); expect(f.observers.every(o => !o.connected)).toBe(true); f.control.dispose();
});
for (const reason of ['zero', 'return', 'zero-total'] as const) it('restores previous drafts without no-op candidates: '+reason, () => {
  const f = fixture(); if (reason === 'zero-total') { f.state.x = 7; f.state.y = 9; }
  const before = [f.state.x, f.state.y]; f.dispatch('pointerdown');
  if (reason === 'return') f.dispatch('pointermove', 8, 3);
  f.dispatch('pointerup', reason === 'zero-total' ? -7 : 0, reason === 'zero-total' ? -9 : 0);
  expect([f.state.x, f.state.y]).toEqual(before); expect(f.sample).not.toHaveBeenCalled(); expect(f.state.preview).toBeNull(); expect(f.captures.size).toBe(0); f.control.dispose();
});
for (const reason of ['input', 'selection', 'policy-restored', 'source', 'view'] as const) it('rejects actual late changes before queued preparation: '+reason, () => {
  const f = fixture(); f.dispatch('pointerdown'); f.dispatch('pointermove', 5, 3);
  if (reason === 'input') { f.state.revision++; f.state.x = 77; }
  if (reason === 'selection') { f.state.revision++; f.state.requests = [{ layerId: 'base', shapeId: 'other' }]; }
  if (reason === 'policy-restored') f.state.policy += 2;
  if (reason === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
  if (reason === 'view') f.view.zoom = 2;
  f.flush(); expect(f.sample).not.toHaveBeenCalled(); expect(f.captures.size).toBe(0); expect(f.error).toHaveBeenCalled(); if (reason === 'input') expect(f.state.x).toBe(77); f.control.dispose();
});
it('captures dedicated policy before layout/source admission and permits a fresh source-valid retry', () => {
  const f = fixture(), rect = f.canvas.getBoundingClientRect; let armed = true;
  f.canvas.getBoundingClientRect = () => { if (armed) { armed = false; f.state.policy += 2; } return rect.call(f.canvas); };
  f.dispatch('pointerdown'); expect(f.captures.size).toBe(0); expect(f.error).toHaveBeenCalled();
  f.dispatch('pointerdown'); f.dispatch('pointerup', 6, 2); expect(f.state.preview).not.toBeNull(); expect(f.captures.size).toBe(0); f.control.dispose();
});
it('rejects release-time source/input changes after native cleanup and preserves explicit values', () => {
  const f = fixture(); let armed = false;
  f.sample.mockImplementation(candidate => {
    expect(f.captures.size).toBe(0); if (armed) { f.state.revision++; f.state.x = 99; }
    return { scene: candidate.layers.map(l => ({ layerId: l.id, key: keyAt(l, 4), sampled: true })), rendered: [] };
  });
  f.dispatch('pointerdown'); armed = true; f.dispatch('pointerup', 10, 6); expect(f.state.x).toBe(99); expect(f.state.preview).toBeNull(); expect(f.error).toHaveBeenCalled(); expect(f.captures.size).toBe(0); f.control.dispose();
});
it('invalidates released gesture proposals separately from independent numeric previews', () => {
  const f = fixture(); f.dispatch('pointerdown'); f.dispatch('pointerup', 10, 6); f.state.policy++; f.control.policyChanged(); expect(f.state.preview).toBeNull(); expect([f.state.x, f.state.y]).toEqual([10, 6]);
  const numeric: SampledSelectionPreview = { context: f.context, owner: {} as never, pose: { scene: [], rendered: [] }, validate() {}, discard() {} }; f.state.preview = numeric;
  f.state.policy++; f.control.policyChanged(); expect(f.state.preview).toBe(numeric); f.control.dispose();
});
it('ignores foreign pointers, nonprimary/touch/secondary entry and late disposed callbacks', () => {
  const f = fixture(); for (const fields of [{ isPrimary: false }, { pointerType: 'touch' }, { button: 2 }]) f.dispatch('pointerdown', 0, 0, fields);
  expect(f.captures.size).toBe(0); f.dispatch('pointerdown'); f.dispatch('pointermove', 10, 2, { pointerId: 2 }); f.dispatch('pointercancel', 0, 0, { pointerId: 2 }); expect(f.captures.has(1)).toBe(true);
  f.dispatch('pointermove', 7, 2); f.control.dispose(); f.callbacks.forEach(cb => cb()); expect(f.sample).not.toHaveBeenCalled(); expect(f.captures.size).toBe(0);
});
it('keeps completed world-pose previews valid after layout changes and restores them on a later cancellation', () => {
  const f = fixture(); f.dispatch('pointerdown'); f.dispatch('pointerup', 10, 6);
  const prior = f.state.preview; f.canvas.rect.top += 40; expect(() => prior!.validate()).not.toThrow();
  f.dispatch('pointerdown'); f.dispatch('pointermove', 5, 2); f.flush(); f.control.cancel();
  expect(f.state.preview).toBe(prior); expect([f.state.x, f.state.y]).toEqual([10, 6]); expect(() => prior!.validate()).not.toThrow(); f.control.dispose();
});
it('rejects a real view change caused by native release before fresh preparation', () => {
  const f = fixture(), release = f.canvas.releasePointerCapture;
  f.canvas.releasePointerCapture = function(id) { release.call(this, id); this.rect.top++; };
  f.dispatch('pointerdown'); f.dispatch('pointerup', 10, 6);
  expect(f.captures.size).toBe(0); expect(f.sample).not.toHaveBeenCalled(); expect(f.state.preview).toBeNull(); expect([f.state.x, f.state.y]).toEqual([0, 0]); expect(f.error).toHaveBeenCalled(); f.control.dispose();
});
it('does not publish superseded preparation when source reads deliver a newer immutable target', () => {
  const f = fixture(), clone = f.context.snapshot; let armed = false;
  f.context.snapshot = () => { const out = clone(); if (armed) { armed = false; f.dispatch('pointermove', 20, 5); } return out; };
  f.dispatch('pointerdown'); f.dispatch('pointermove', 5, 2); armed = true; f.flush();
  expect(f.state.preview).toBeNull(); expect(f.frames.size).toBe(1); f.flush(); expect(f.state.preview!.pose.rendered.find(s => s.id === 'r')!.x).toBe(60); expect(f.error).not.toHaveBeenCalled(); f.control.dispose();
});

it('authors only an explicitly opted-in fresh release after native cleanup',()=>{
 const f=fixture(),before=structuredClone(f.project);f.state.authoring=true;f.state.authorPolicy=0;
 f.dispatch('pointerdown');f.dispatch('pointermove',5,2);f.flush();expect(f.publish).not.toHaveBeenCalled();
 f.dispatch('pointermove',10,6);f.dispatch('pointerup',20,8);
 expect(f.events).toEqual(['capture','sample:1','release','sample:0']);expect(f.published).toHaveLength(1);
 expect(f.published[0].layers.map(l=>keyAt(l,4).shapes.map(s=>[s.id,s.x,s.y]))).toEqual([
 [['r',60,18],['b',60,10],['a',80,10],['other',190,10]],
 [['r',32,100],['b',72,108],['a',92,108],['other',182,100]]]);
 expect(f.project).toEqual(before);expect(f.captures.size).toBe(0);expect(f.observers.every(o=>!o.connected)).toBe(true);
 f.callbacks.forEach(cb=>cb());expect(f.published).toHaveLength(1);f.control.dispose();
});
for(const phase of ['initial','queued','release','publication']as const)for(const change of ['author','gesture','target','source','view']as const)
it('rejects '+phase+' late '+change+' before selection release history',()=>{
 const f=fixture();f.state.authoring=true;f.state.authorPolicy=0;let armed=true;
 const mutate=()=>{if(!armed)return;armed=false;if(change==='author')f.state.authorPolicy!+=2;else if(change==='gesture')f.state.policy+=2;else if(change==='target'){f.state.revision+=2;f.state.x=111;}else if(change==='source')f.project.layers[0].keys[0].shapes[0].fill='#00ff00';else f.canvas.rect.top++;};
 if(phase==='initial'){if(change==='view'){const snapshot=f.context.snapshot;f.context.snapshot=()=>{const out=snapshot();mutate();return out;};}else{const rect=f.canvas.getBoundingClientRect;f.canvas.getBoundingClientRect=()=>{mutate();return rect.call(f.canvas);};}f.dispatch('pointerdown');}
 else {f.dispatch('pointerdown');if(phase==='queued'){f.dispatch('pointermove',5,2);mutate();f.flush();}
 else if(phase==='release'){f.sample.mockImplementation(candidate=>{expect(f.captures.size).toBe(0);mutate();return{scene:candidate.layers.map(l=>({layerId:l.id,key:keyAt(l,4),sampled:true})),rendered:[]};});f.dispatch('pointerup',10,6);}
 else {f.publish.mockImplementation(edit=>{admitSampledSelectionPublication(edit);mutate();edit.validate();f.published.push(edit.candidate);});f.dispatch('pointerup',10,6);}}
 expect(f.published).toHaveLength(0);expect(f.captures.size).toBe(0);expect(f.error).toHaveBeenCalled();f.control.dispose();
});
it('captures and restores authoring opt-out independently and permits fresh drafts then fresh authoring',()=>{
 const f=fixture();f.state.authoring=true;f.state.authorPolicy=0;
 f.dispatch('pointerdown');f.state.authoring=false;f.state.authorPolicy++;f.control.policyChanged();
 f.dispatch('pointerdown');f.dispatch('pointerup',10,6);expect(f.state.preview).not.toBeNull();expect(f.published).toHaveLength(0);
 f.state.authoring=true;f.state.authorPolicy++;f.control.policyChanged();f.dispatch('pointerdown');f.dispatch('pointerup',5,2);expect(f.published).toHaveLength(1);expect(f.captures.size).toBe(0);f.control.dispose();
});
