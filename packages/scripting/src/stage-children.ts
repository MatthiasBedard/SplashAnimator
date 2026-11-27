import { symbolLayers, type Layer, type Project, type Vector } from '../../document/src';
import { MAX_HTML_COMPILED_SHAPES } from '../../export-web/src/live-timeline';
import { symbolLocalFrame } from '../../geometry/src/symbols';
import type { StagePlacement } from './stage-placements';

type ShapeRef = { id: string; name: string; symbolId: string; playback?: Vector['symbolPlayback'] };
type Exposure = { frame: number; items: ShapeRef[] };
type Definition = { duration: number; tracks: { id: string; keys: Exposure[] }[] };
export type ScriptGraphicParent = {
  id: string;
  symbolId: string;
  layerId: string;
  start: number;
  playback?: Vector['symbolPlayback'];
};

/** Copy authored metadata only. Noninteractive lookup confers no rendering authority. */
export function captureGraphicChildren(project: Pick<Project, 'symbols' | 'layerMasks'>, scriptedIds?: ReadonlySet<string>) {
  const source = new Map(project.symbols?.map(definition => [definition.id, definition]));
  const definitions = new Map<string, Definition | undefined>();
  const masked = new Set(project.layerMasks?.flatMap(mask => [mask.maskLayerId, ...mask.layerIds]));
  const resolving = new Set<string>();
  let work = 0;
  function definitionFor(id: string) {
    if (definitions.has(id)) return definitions.get(id);
    if (resolving.has(id) || resolving.size>=8) throw Error('Nested script symbol cycle or depth limit.');
    resolving.add(id);
    const definition = source.get(id);
    let result: Definition | undefined;
    if (definition && (!definition.buttonStates||scriptedIds) && !definition.timeline?.layerMasks?.length) {
      const layers = symbolLayers(definition).filter(layer => layer.visible);
      const extraIds = new Set(layers.filter(layer => layer.id !== '@base').map(layer => layer.id));
      const tracks: Definition['tracks'] = [];
      let hasChild = false;
      for (const layer of layers) {
        // A slash belongs to the renderer's path syntax and would make these identities ambiguous.
        if (layer.id.includes('/') || layer.keys.some(key => key.shapes.some(shape =>
          shape.kind === 'symbol' && (shape.id.includes('/') || (layer.id === '@base' && extraIds.has(shape.id)))))) {
          definitions.set(id,undefined);
          resolving.delete(id);
          return undefined;
        }
        if (layer.motionSpans?.length || layer.liveMotionSpans?.length) continue;
        const keys: Exposure[] = [];
        for (const key of layer.keys) {
          const items: ShapeRef[] = [];
          for (const shape of key.shapes) {
            if (shape.kind !== 'symbol' || !shape.instanceName || !shape.symbolId ||
                !source.has(shape.symbolId) || source.get(shape.symbolId)?.buttonStates ||
                (scriptedIds
                  ? !scriptedIds.has(shape.symbolId)&&!definitionFor(shape.symbolId)
                  : shape.symbolPlayback?.mode === 'movie')) continue;
            if (++work > MAX_HTML_COMPILED_SHAPES) throw Error('Script graphic children exceed the capture budget.');
            items.push({id:shape.id,name:shape.instanceName,symbolId:shape.symbolId,
              ...(scriptedIds&&shape.symbolPlayback?{playback:{...shape.symbolPlayback}}:{})});
          }
          if (items.length) hasChild = true;
          if (items.length || keys.at(-1)?.items.length) keys.push({frame:key.frame,items});
        }
        if (keys.length) tracks.push({id:layer.id,keys});
      }
      if (hasChild) result = {duration:definition.timeline?.duration ?? 1,tracks};
    }
    definitions.set(id,result);
    resolving.delete(id);
    return result;
  }
  return {
    identity() {
      return [...definitions].filter(([,definition])=>definition !== undefined);
    },
    exposures(symbolId:string) {
      return definitionFor(symbolId);
    },
    capture(layer: Layer, key: Layer['keys'][number]): ScriptGraphicParent[] {
      if (!layer.visible || layer.guideLayer || masked.has(layer.id) ||
          layer.motionSpans?.length || layer.liveMotionSpans?.length) return [];
      // The same layer is allowed to have arbitrary authored IDs. Keep flattened
      // child paths clear of any root whose ID already enters that namespace.
      const prefixes = new Set<string>();
      for (const shape of key.shapes) {
        const slash = shape.id.indexOf('/');
        if (slash !== -1) prefixes.add(shape.id.slice(0,slash));
      }
      return key.shapes.flatMap(shape => {
        if (shape.kind !== 'symbol' || !shape.instanceName || !shape.id || shape.id.includes('/') ||
            prefixes.has(shape.id) || !shape.symbolId || source.get(shape.symbolId)?.buttonStates ||
            (!scriptedIds&&shape.symbolPlayback?.mode === 'movie') ||
            !definitionFor(shape.symbolId)) return [];
        return [{id:shape.id,symbolId:shape.symbolId,layerId:layer.id,start:key.frame,
          ...(shape.symbolPlayback ? {playback:{...shape.symbolPlayback}} : {})}];
      });
    },
    append(parent: ScriptGraphicParent, frame: number, output: StagePlacement[]) {
      const definition = definitions.get(parent.symbolId)!;
      const local = symbolLocalFrame(definition.duration,frame-parent.start,parent.playback);
      for (const track of definition.tracks) {
        let low = 0, high = track.keys.length;
        while (low < high) {
          const next = Math.floor((low+high)/2);
          if (track.keys[next].frame <= local) low = next+1;
          else high = next;
        }
        for (const item of track.keys[low-1]?.items ?? []) {
          if (output.length >= 100000) throw Error('Script graphic children exceed the frame budget.');
          output.push({...item,id:parent.id+(track.id === '@base' ? '' : '/'+track.id)+'/'+item.id,
            parentId:parent.id,layerId:parent.layerId,visible:true});
        }
      }
    },
  };
}
