import { describe, expect, it } from 'vitest';
import { addScopedBitmaps, scopedBitmaps, composeScopedSymbolProject, finishSymbolScene, ownScopedSymbolCreation, prepareSymbolScene, replaceScopedTimeline, scopedNestedDefinitions, setSymbolSceneButtonFrame, stageScopedNestedDefinitions, symbolSceneButtonStates } from '../apps/editor/src/symbol-scene-scope';
import { newProject, validateProject, type SymbolDefinition, type Vector } from '../packages/document/src';
import { symbolEditContext } from '../packages/geometry/src/symbol-context';
import { symbolInstance } from '../packages/geometry/src/symbols';

function fixture() {
  const art: Vector = { id: 'art', kind: 'rectangle', x: 2, y: 4, width: 20, height: 30, rotation: 0,
    opacity: 1, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
  const definition: SymbolDefinition = { id: 'clip', name: 'Clip', width: 40, height: 50, shapes: [art],
    timeline: { duration: 5, keys: [{ frame: 3, shapes: [{ ...art, x: 5 }] }],
      layers: [{ id: 'paint', name: 'Paint', visible: true, locked: false, keys: [{ frame: 0, shapes: [] }] }] } };
  const source = newProject();
  const instance = symbolInstance(definition, 100, 120);
  instance.transform = [2, 0, 0, 2];
  source.symbols = [definition];
  source.layers[0].keys[0].shapes = [{ ...art, id: 'reference', x: 116, y: 144 }, instance];
  return { art, definition, source, instance };
}

describe('shared symbol scene scope', () => {
  it('admits explicit mask membership only on original symbol tracks and preserves source artwork', () => {
    const { definition, source } = fixture();
    const draft = prepareSymbolScene(source, definition)!;
    draft.project.layerMasks = [{ maskLayerId: 'paint', layerIds: ['@base'] }];
    const edited = finishSymbolScene(definition, draft.original, draft.project);
    const saved = composeScopedSymbolProject(source, [edited]);
    expect(saved.schemaVersion).toBe(60);
    expect(saved.layerMasks).toBeUndefined();
    expect(source.schemaVersion).toBe(59);
    expect(definition.timeline!.layerMasks).toBeUndefined();
    expect(prepareSymbolScene(saved, edited)!.project.layerMasks).toEqual(draft.project.layerMasks);
    expect(() => validateProject({ ...saved, schemaVersion: 59 })).toThrow(/schema 60/);
    edited.timeline!.layerMasks![0].layerIds = ['foreign'];
    expect(() => composeScopedSymbolProject(source, [edited])).toThrow(/mask/i);
    let reads = 0;
    Object.defineProperty(edited.timeline, 'layerMasks', { enumerable: true, get() { reads++; return []; } });
    expect(() => validateProject({ ...saved, symbols: [edited] })).toThrow();
    expect(reads).toBe(0);
  });

  it('preserves fractional definition bounds and edits beyond both temporary stage axes', () => {
    const { definition, source } = fixture();
    definition.width = 12000.25;
    definition.height = 10000.5;
    Object.assign(definition.shapes[0], { x: 11900, y: 9900 });
    const original = structuredClone(definition);
    const scope = prepareSymbolScene(source, definition)!;
    expect(scope.extent).toEqual({ width: 12001, height: 10001 });
    expect([scope.project.width, scope.project.height]).toEqual([8192, 8192]);
    validateProject(scope.project);
    expect(() => validateProject({ ...source, width: 12001 })).toThrow();
    scope.project.layers[0].keys[0].shapes[0].y++;
    const expected = structuredClone(original);
    expected.shapes[0].y++;
    expect(finishSymbolScene(definition, scope.original, scope.project)).toEqual(expected);
    expect(definition).toEqual(original);
    expect(prepareSymbolScene(source, { ...definition, width: Number.MAX_VALUE })).toBeNull();
  });

  it('carries only newly owned bitmap assets from a child into the parent and enclosing scene', () => {
    const { definition, source } = fixture();
    const bitmap = (id: string) => ({ id, path: 'assets/bitmaps/' + id + '.json',
      bitmap: { name: id + '.png', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=' } });
    source.assets.push(bitmap('existing'));
    const parent = prepareSymbolScene(source, definition)!;
    addScopedBitmaps(parent.project, [bitmap('parent')]);
    const child = prepareSymbolScene(parent.project, definition)!;
    addScopedBitmaps(child.project, [bitmap('child')]);
    const additions = scopedBitmaps(child.original, child.project);
    const staged = stageScopedNestedDefinitions(parent.original, parent.project, [definition], additions);
    const all = scopedBitmaps(parent.original, staged);
    expect(all.map(item => item.id)).toEqual(['parent', 'child']);
    const result = composeScopedSymbolProject(source, [definition], all);
    expect(result.assets.map(item => item.id)).toEqual(['existing', 'parent', 'child']);
    expect(source.assets).toHaveLength(1);
    expect(parent.project.assets).toHaveLength(2);
    staged.assets[0].bitmap!.name = 'unowned edit';
    expect(() => finishSymbolScene(definition, parent.original, staged)).toThrow(/unowned bitmap/);
  });

  it('admits new nested definitions with the edited parent and rejects a cycle atomically', () => {
    const { art, definition, source } = fixture();
    const scope = prepareSymbolScene(source, definition)!;
    const child = { id: 'new-child', name: 'New child', width: 20, height: 30, shapes: [art] };
    const edited = structuredClone(scope.project);
    edited.symbols!.push(child);
    edited.layers[0].drawingMode = 'object';
    edited.layers[0].keys[0].shapes = [symbolInstance(child, art.x, art.y)];
    expect(() => finishSymbolScene(definition, scope.original, edited)).toThrow(/scene-level data/);
    ownScopedSymbolCreation(scope.original, scope.project, edited, child.id);
    const parent = finishSymbolScene(definition, scope.original, edited);
    const staged = scopedNestedDefinitions(scope.original, edited);
    const invalidChild = { ...child, shapes: [symbolInstance(parent, 0, 0)] };
    expect(() => composeScopedSymbolProject(source, [parent, invalidChild])).toThrow(/cycle/);
    expect(source.symbols).toEqual([definition]);
    const result = composeScopedSymbolProject(source, [parent, ...staged]);
    expect(result.symbols).toEqual([parent, child]);
    expect(result.layers).toEqual(source.layers);
  });

  it('replays an advanced definition into the same scoped project with its drawing mode', () => {
    const { definition, source } = fixture();
    const scope = prepareSymbolScene(source, definition)!;
    scope.project.layers[0].drawingMode = 'object';
    const advanced = structuredClone(definition);
    advanced.timeline!.keys.push({ frame: 4, shapes: [] });
    const result = replaceScopedTimeline(scope.project, advanced);
    expect(result.id).toBe(scope.project.id);
    expect(result.layers[0].drawingMode).toBe('object');
    expect(result.symbols).toEqual(scope.project.symbols);
    expect(finishSymbolScene(definition, scope.original, result)).toEqual(advanced);
    expect(scope.project.layers[0].keys).toHaveLength(2);
  });

  it('tracks locally applied child artwork while guarding other library data', () => {
    const { art, definition, source } = fixture();
    const child = { id: 'child', name: 'Child', width: 20, height: 30, shapes: [art] };
    source.symbols!.push(child);
    const scope = prepareSymbolScene(source, definition)!;
    const edit = { ...child, shapes: [{ ...art, fill: '#0000ff' }] };
    const staged = stageScopedNestedDefinitions(scope.original, scope.project, [edit]);
    expect(scopedNestedDefinitions(scope.original, staged).map(item => [item.id, item.shapes[0].fill])).toEqual([['child', '#0000ff']]);
    expect(finishSymbolScene(definition, scope.original, staged)).toEqual(definition);
    expect(scope.project.symbols![1].shapes[0].fill).toBe('#ff0000');
    staged.symbols![1].name = 'Unowned rename';
    expect(() => finishSymbolScene(definition, scope.original, staged)).toThrow(/unowned library/);
  });

  it('preserves Button mappings and rejects a duration that would drop a mapped frame', () => {
    const { definition, source } = fixture();
    definition.buttonStates = { up: 3, over: 0, down: 0, hit: 4 };
    const scope = prepareSymbolScene(source, definition)!;
    expect(finishSymbolScene(definition, scope.original, scope.project)).toEqual(definition);
    for (const at of [-1, 5, 1.5, Infinity, NaN])
      expect(() => setSymbolSceneButtonFrame(scope.project, 'up', at)).toThrow(/within the timeline/);
    expect(symbolSceneButtonStates(scope.project)).toEqual(definition.buttonStates);
    setSymbolSceneButtonFrame(scope.project, 'up', 0);
    const result = finishSymbolScene(definition, scope.original, scope.project);
    expect(result).toEqual({ ...definition, buttonStates: { ...definition.buttonStates, up: 0 } });
    expect(symbolSceneButtonStates(scope.original)?.up).toBe(3);
    expect(definition.buttonStates.up).toBe(3);
    setSymbolSceneButtonFrame(scope.project, 'up', 1);
    expect(result.buttonStates?.up).toBe(0);
    scope.project.duration = 4;
    expect(() => finishSymbolScene(definition, scope.original, scope.project)).toThrow(/mapped Button state frames/);
    expect(definition.timeline?.duration).toBe(5);
  });

  it('maps frozen reference artwork to the symbol coordinate space and round-trips omitted settings', () => {
    const { definition, source, instance } = fixture();
    const context = symbolEditContext(source, source.layers[0].id, instance.id, 0);
    const scope = prepareSymbolScene(source, definition, context)!;
    expect(scope.stage?.under[0]).toMatchObject({ x: 8, y: 12 });
    expect(context.under[0]).toMatchObject({ x: 116, y: 144 });
    expect(finishSymbolScene(definition, scope.original, scope.project)).toEqual(definition);
  });

  it('publishes detached keys and layer settings while preserving the scene and later keys', () => {
    const { art, definition, source } = fixture();
    const scope = prepareSymbolScene(source, definition)!;
    scope.project.layers[0].keys.splice(1, 0, { frame: 2, shapes: [{ ...art, x: 8 }] });
    scope.project.layers[1].outline = true;
    const result = finishSymbolScene(definition, scope.original, scope.project);
    validateProject({ ...source, symbols: [result] });
    scope.project.layers[0].keys[1].shapes[0].x = 99;
    expect(result.timeline?.keys.map(k => [k.frame, k.shapes[0].x])).toEqual([[2, 8], [3, 5]]);
    expect(result.timeline?.layers?.[0].outline).toBe(true);
    expect(definition.timeline?.keys.map(k => k.frame)).toEqual([3]);
    expect(definition.timeline?.layers?.[0].outline).toBeUndefined();
  });

  it('rejects edits to enclosing library metadata and reserved base ownership', () => {
    const { definition, source } = fixture();
    const scope = prepareSymbolScene(source, definition)!;
    scope.project.symbols![0].name = 'Changed library item';
    expect(() => finishSymbolScene(definition, scope.original, scope.project)).toThrow(/scene-level data/);
    const fresh = prepareSymbolScene(source, definition)!;
    fresh.project.layers.reverse();
    expect(() => finishSymbolScene(definition, fresh.original, fresh.project)).toThrow(/base layer/);
  });

  it('keeps the signed reflected basis and inverse-maps the detached reference', () => {
    const { definition, source, instance } = fixture();
    instance.transform = [-2, 0, 1, 1];
    const context = symbolEditContext(source, source.layers[0].id, instance.id, 0);
    const scope = prepareSymbolScene(source, definition, context)!;
    expect(scope.stage).toMatchObject({
      scale: 2, aspect: -0.5, shear: -0.5, rotation: 180,
      under: [{ x: 4, y: 24, transform: [-0.5, 0, 0.5, 1] }],
    });
    expect(context.under[0]).toMatchObject({ x: 116, y: 144 });
    expect(instance.transform).toEqual([-2, 0, 1, 1]);
    expect(prepareSymbolScene(source, definition, { ...context, matrix: [1, 0, 1, 0, 0, 0] })).toBeNull();
    expect(prepareSymbolScene(source, definition)).not.toBeNull();
  });

  it('inverse-maps skewed references without editing their original basis', () => {
    const { definition, source, instance } = fixture();
    instance.transform = [2, 0, 1, 1];
    const context = symbolEditContext(source, source.layers[0].id, instance.id, 0);
    const scope = prepareSymbolScene(source, definition, context)!;
    expect(scope.stage).toMatchObject({
      scale: 2, aspect: 0.5, shear: 0.5, rotation: 0,
      under: [{ x: -4, y: 24, transform: [0.5, 0, -0.5, 1] }],
    });
    expect(context.under[0]).toMatchObject({ x: 116, y: 144 });
    expect(instance.transform).toEqual([2, 0, 1, 1]);
  });

  it('keeps source and target mask slots distinct and honors source outline mode', () => {
    const { art, definition, source, instance } = fixture();
    instance.transform = [2, 0, 0, 1];
    const context = symbolEditContext(source, source.layers[0].id, instance.id, 0);
    const scope = prepareSymbolScene(source, definition, context)!;
    expect(scope.stage).toMatchObject({
      scale: 2, aspect: 0.5, rotation: 0,
      under: [{ x: 8, y: 24, transform: [0.5, 0, 0, 1] }],
    });
    expect(context.under[0]).toMatchObject({ x: 116, y: 144 });
    const alpha: Vector = { ...art, id: 'alpha', x: 110, y: 130, opacity: 0.5 };
    const maskLayer = { ...source.layers[0], id: 'mask', keys: [{ frame: 0, shapes: [alpha] }] };
    source.layers.push(maskLayer);
    source.layerMasks = [{ maskLayerId: maskLayer.id, layerIds: [source.layers[0].id] }];
    validateProject(source);
    const masked = symbolEditContext(source, source.layers[0].id, instance.id, 0);
    expect(masked.referenceLayers?.root).toBe(source.layers[0].id);
    const targetStage = prepareSymbolScene(source, definition, masked)!.stage!;
    expect(targetStage.enclosingMask).toMatchObject({
      editingSource: false,
      under: [{ shape: { id: 'reference', x: 8, y: 24 } }],
      over: [],
      sourceUnder: [],
      sourceOver: [{ shape: { id: 'alpha', x: 5, y: 10, opacity: 0.5 } }],
    });
    expect(targetStage.under).toEqual([]);
    expect(targetStage.over).toEqual([]);
    expect(masked.over[0]).toMatchObject({ x: 110, y: 130, opacity: 0.5 });
    expect(alpha.x).toBe(110);

    source.layers[0].keys[0].shapes.pop();
    maskLayer.keys[0].shapes.push(instance, { ...alpha, id: 'alpha-over' });
    const maskSource = symbolEditContext(source, maskLayer.id, instance.id, 0);
    const sourceStage = prepareSymbolScene(source, definition, maskSource)!.stage!;
    expect(sourceStage.enclosingMask).toMatchObject({
      editingSource: true,
      under: [{ shape: { id: 'reference' } }],
      over: [],
      sourceUnder: [{ shape: { id: 'alpha', opacity: 0.5 } }],
      sourceOver: [{ shape: { id: 'alpha-over', opacity: 0.5 } }],
    });
    Object.assign(maskLayer, { outline: true });
    const outlined = symbolEditContext(source, maskLayer.id, instance.id, 0);
    expect(prepareSymbolScene(source, definition, outlined)!.stage!.enclosingMask).toBeUndefined();
  });
});
