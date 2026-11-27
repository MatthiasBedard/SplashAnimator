import { createBoundOpacitySampler } from './opacity-binding';
import { createRememberedTimelineSampler } from './motion-timeline';
import { sampleRememberedMotionFrames } from './motion-spans';
import type { MotionRevisionSource } from './motion-revision';

type TrackOwner = {
  spanId: string;
  start: number;
  end: number;
  artwork: Map<string, number>;
};

/** Bind a displayed root scene and its editable identities to the same source read.
 * The editor advances revision on every source change and discards the capture
 * when the displayed frame changes. Rendering may mutate its detached scene;
 * resolution never uses those coordinates or takes artwork from that scene.
 */
export function captureRememberedAuthoringFrame(readSource: () => MotionRevisionSource, frame: number) {
  const initial = readSource();
  let source: MotionRevisionSource | undefined = {project:initial.project, revision:initial.revision};
  function current() {
    const expected = source;
    if (!expected) throw new Error('Sampled motion capture is disposed.');
    const live = readSource();
    if (source !== expected || expected.project !== live.project || expected.revision !== live.revision)
      throw new Error('Sampled motion source changed. Sample the frame again.');
    return expected;
  }

  const sampler = current().project.opacityBindings?.length ? createBoundOpacitySampler(current) : createRememberedTimelineSampler(current);
  const owners = new Map<string, TrackOwner>();
  try {
    const scene = sampler.sample(frame);
    const project = current().project;
    const layers = new Map(project.layers.map(layer => [layer.id,layer]));
    if (layers.size !== project.layers.length) throw new Error('Ambiguous root track identity.');
    for (const track of scene) {
      if (!track.sampled) continue;
      const layer = layers.get(track.layerId)!;
      if (layer.locked) continue;
      const span = layer.motionSpans!.find(candidate => candidate.start < frame && frame < candidate.end)!;
      const artwork = new Map<string, number>();
      for (const shape of track.key.shapes) artwork.set(shape.id, (artwork.get(shape.id) ?? 0) + 1);
      owners.set(layer.id, {spanId:span.id, start:span.start, end:span.end, artwork});
    }
    current();
    return {
      scene,
      // UI choices are detached hints only. resolve() repeats admission at command time.
      choices: [...owners].flatMap(([layerId,owner]) => frame-owner.start<2 || owner.end-frame<2 ? [] :
        [...owner.artwork].filter(([id,count])=>id&&count===1).map(([shapeId])=>({layerId,shapeId}))),
      resolve(layerId: string, shapeId: string) {
        const {project, revision} = current();
        const owner = owners.get(layerId);
        if (!owner || !shapeId || owner.artwork.get(shapeId) !== 1)
          throw new Error('Choose one sampled root artwork item on a visible, unlocked track.');
        const layers = project.layers.filter(layer => layer.id === layerId);
        const layer = layers[0];
        if (layers.length !== 1 || !layer.visible || layer.locked)
          throw new Error('Sampled motion track is missing, locked, hidden or ambiguous.');
        const spans = layer.motionSpans ?? [];
        const covering = spans.filter(span => span.start <= frame && frame <= span.end);
        if (covering.length !== 1 || covering[0].id !== owner.spanId ||
            covering[0].start !== owner.start || covering[0].end !== owner.end ||
            spans.filter(span => span.id === owner.spanId).length !== 1)
          throw new Error('Sampled artwork no longer has its original unique recipe.');
        if (frame - owner.start < 2 || owner.end - frame < 2)
          throw new Error('Promotion requires at least three frames in each half.');
        // Fresh baseline and endpoint admission, even if a cached render still exists.
        const [pose] = sampleRememberedMotionFrames(project,[layerId],owner.start,owner.end,frame);
        const generated = layer.keys.find(key => key.frame === frame)!;
        if ([pose.shapes,generated.shapes].some(shapes => shapes.filter(shape => shape.id === shapeId).length !== 1))
          throw new Error('Selected artwork does not uniquely belong to this generated key.');
        current();
        return {layerId,shapeId,frame,spanId:owner.spanId,start:owner.start,end:owner.end,revision};
      },
      dispose() { owners.clear(); source = undefined; },
    };
  } finally { sampler.dispose(); }
}

export type SampledMotionOwner = ReturnType<ReturnType<typeof captureRememberedAuthoringFrame>['resolve']>;
