import { afterEach, expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { createSampledSelectionContext, prepareSampledSelectionTranslation, admitSampledSelectionPublication, type SampledSelectionState } from '../apps/editor/src/sampled-selection-editor';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const project = newProject(); project.duration = 12; const layer = project.layers[0]; layer.id = 'base';
  const shape = (id: string, x: number): Vector => ({ id, kind: 'rectangle', x, y: 10, width: 12, height: 12, rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] });
  layer.keys = [{ frame: 0, shapes: [shape('r', 0), shape('b', 20)] }, { frame: 8, shapes: [shape('r', 80), shape('b', 100)] }, { frame: 10, shapes: [] }];
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear');
  const state: SampledSelectionState = { project, signature: JSON.stringify(project), frame: 4, revision: 1, policy: 0, groups: false, pick: null, children: false, prepared: null, stamp: 'source', blocked: false };
  const context = createSampledSelectionContext(() => state, source => structuredClone(source), () => ({ scene: [], rendered: [] }))!;
  return { state, context };
}
const requests = [{ layerId: 'base', shapeId: 'b' }, { layerId: 'base', shapeId: 'r' }];

it('freshly prepares a complete original selection without source or history writes', () => {
  const { state, context } = fixture(), before = structuredClone(state.project);
  const edit = prepareSampledSelectionTranslation(context, requests, { x: 5, y: 4 }, () => {});
  expect(edit.owner.tracks[0].shapeIds).toEqual(['r', 'b']);
  expect(edit.candidate.layers[0].keys[4].shapes.map(s => [s.x, s.y])).toEqual([[45, 14], [65, 14]]);
  admitSampledSelectionPublication(edit); expect(edit.snapshot).toEqual(before); expect(state.project).toEqual(before);
});
it('snapshots raw selected identities and numeric offsets once before resolving/preparing', () => {
  const { context } = fixture(), reads = { layer: 0, id: 0, x: 0, y: 0 };
  prepareSampledSelectionTranslation(context, [{ get layerId() { reads.layer++; return 'base'; }, get shapeId() { reads.id++; return 'r'; } }], { get x() { reads.x++; return 5; }, get y() { reads.y++; return 4; } }, () => {});
  expect(reads).toEqual({ layer: 1, id: 1, x: 1, y: 1 });
});
for (const field of ['project', 'frame', 'revision', 'policy', 'groups', 'pick', 'children', 'prepared', 'signature', 'blocked'] as const)
  it('rejects changed original context before publication: ' + field, () => {
    const { state, context } = fixture(), edit = prepareSampledSelectionTranslation(context, requests, { x: 5, y: 4 }, () => {});
    if (field === 'project') state.project = structuredClone(state.project);
    if (field === 'frame' || field === 'revision' || field === 'policy') state[field]++;
    if (field === 'groups' || field === 'children' || field === 'blocked') state[field] = true;
    if (field === 'pick' || field === 'prepared') state[field] = {};
    if (field === 'signature') state.signature = 'changed';
    expect(() => admitSampledSelectionPublication(edit)).toThrow();
  });
it('detects original content mutation even when a cached render signature has not updated', () => {
  const { state, context } = fixture(), edit = prepareSampledSelectionTranslation(context, requests, { x: 5, y: 4 }, () => {});
  state.project.layers[0].keys[0].shapes[0].fill = '#00ff00'; expect(() => admitSampledSelectionPublication(edit)).toThrow(/source changed/);
});
it('rejects changed-and-restored inputs and permits a fresh original-source retry', () => {
  const { state, context } = fixture(); let revision = 0;
  const prepare = () => { const original = revision; return prepareSampledSelectionTranslation(context, requests, { x: 5, y: 4 }, () => { if (revision !== original) throw Error('inputs changed'); }); };
  const first = prepare(); revision += 2; expect(() => admitSampledSelectionPublication(first)).toThrow(/inputs changed/);
  admitSampledSelectionPublication(prepare()); expect(state.project.layers[0].motionSpans).toHaveLength(1);
});
it('rechecks input ownership after the final source metadata read', () => {
  const { context } = fixture(); let armed = false, reads = 0, revision = 0;
  const captured = { ...context, validate() { context.validate(); if (armed && ++reads === 2) revision++; } };
  const edit = prepareSampledSelectionTranslation(captured, requests, { x: 5, y: 4 }, () => { if (revision) throw Error('late input'); });
  armed = true; expect(() => edit.validate()).toThrow(/late input/); expect(reads).toBe(2);
});
it('rejects an actual input edit while reading the complete final candidate', () => {
  const { state, context } = fixture(); let revision = 0, completed = false;
  const edit = prepareSampledSelectionTranslation(context, requests, { x: 5, y: 4 }, () => { if (revision) throw Error('late input'); }), stringify = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, replacer?: unknown, space?: string | number) => { const out = stringify(value, replacer as never, space); if (value === edit.candidate) { completed = true; revision++; } return out; }) as typeof JSON.stringify);
  expect(() => admitSampledSelectionPublication(edit)).toThrow(/late input/); expect(completed).toBe(true); expect(state.project.layers[0].motionSpans).toHaveLength(1);
});
