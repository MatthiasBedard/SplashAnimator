import {
  clone,
  newProject,
  symbolLayers,
  type Project,
  type SymbolDefinition,
} from '../../document/src';

/** Detached adapter for the shared whole-exposure editing operations. */
export function symbolMultiFrameProject(
  definition: SymbolDefinition,
  symbols: SymbolDefinition[],
  assets: Project['assets'],
) {
  const project = newProject();
  project.id = definition.id;
  project.duration = definition.timeline?.duration ?? 1;
  project.layers = clone(symbolLayers(definition));
  project.assets = assets;
  project.symbols = symbols.map((s) => (s.id === definition.id ? definition : s));
  return project;
}

export function symbolFromMultiFrameProject(definition: SymbolDefinition, project: Project) {
  const result = clone(definition);
  const base = project.layers.find((l) => l.id === '@base');
  if (!base) throw new Error('Missing symbol base layer.');
  result.shapes = clone(base.keys[0].shapes);
  if (base.keys[0].openMotionTween) result.openMotionTween = clone(base.keys[0].openMotionTween);
  else delete result.openMotionTween;
  if (result.timeline) {
    result.timeline.keys = clone(base.keys.filter((k) => k.frame > 0));
    if (result.timeline.layers)
      result.timeline.layers = clone(project.layers.filter((l) => l.id !== '@base'));
  }
  return result;
}
