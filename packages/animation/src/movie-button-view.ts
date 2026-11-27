import {
  admitPresentationClock,
  capturePresentationBank,
  detachLayerPresentation,
  detachPresentationData,
} from './layer-presentation';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { createButtonChildViewBank } from './button-child-view';
import { movieButtonEntrySeconds } from './button-exposure';
import { validateProject, symbolLayers, type Project, type Vector } from '../../document/src';
import { matrix, multiply } from '../../geometry/src/affine';
import { expandSymbols } from '../../geometry/src/symbols';
import { createGraphicButtonView, type RootButton } from './button-preview';
import {
  compileGraphicButtonPlan,
  compileGraphicButtonLifetimes,
  sampleGraphicButtonPlan,
  graphicButtonLifetimesAt,
} from './graphic-button-plan';

export function movieButtonExportToken(signature:string,span:{identity:string;start:number;end:number}){
  return JSON.stringify(['movie',signature,span.identity,span.start,span.end]);
}

export function stateMovieButtonSignature(parent:string,frame:number,instanceId:string,symbolId:string){
  return JSON.stringify(['state-movie',parent,frame,instanceId,symbolId]);
}

export type MoviePlacementRoute=readonly (readonly [string,string])[];
export function nestedSceneMovieButtonSignature(layer:string,ancestors:MoviePlacementRoute,instanceId:string,symbolId:string){
  return JSON.stringify(['nested-scene-movie',layer,ancestors,instanceId,symbolId]);
}

/** Definition-shared movie-local views; callers supply clock elapsed frames and scope origins.
 * Movie children remain leaves so recursive routing can retain the clock's exact namespaces.
 */
export function createMovieButtonViewBank(project: Project) {
  const definitions = new Map(project.symbols?.map((d) => [d.id, d]));
  const plans = new Map<
    string,
    {
      plan: ReturnType<typeof compileGraphicButtonPlan>;
      spans: ReturnType<typeof compileGraphicButtonLifetimes>;
    }
  >();
  return {
    sample(instance: Vector, layerId: string, elapsed: number, origin: number) {
      const definition = definitions.get(instance.symbolId!);
      if (
        instance.kind !== 'symbol' ||
        instance.symbolPlayback?.mode !== 'movie' ||
        !definition ||
        definition.buttonStates
      )
        throw new Error('Choose an ordinary movie instance.');
      let compiled = plans.get(definition.id);
      if (!compiled) {
        const plan = compileGraphicButtonPlan({
          ...project,
          duration: definition.timeline?.duration ?? 1,
          layers: symbolLayers(definition),
        });
        compiled = { plan, spans: compileGraphicButtonLifetimes(plan) };
        plans.set(definition.id, compiled);
      }
      const duration = compiled.plan.root.duration;
      const position =
        Math.min(instance.symbolPlayback.firstFrame, duration - 1) +
        Math.max(0, Math.floor(elapsed));
      const frame = position % duration;
      const active = new Map(
        graphicButtonLifetimesAt(compiled.spans, duration, frame).map((s) => [
          JSON.stringify([s.layerId, s.path]),
          s,
        ]),
      );
      const basis = multiply(matrix(instance), [
        definition.width ? instance.width / definition.width : 1,
        0,
        0,
        definition.height ? instance.height / definition.height : 1,
        0,
        0,
      ]);
      function place(source: Vector, localLayer: string): Vector {
        const prefix = instance.id + (localLayer === '@base' ? '' : '/' + localLayer);
        const m = multiply(basis, matrix(source));
        return {
          ...source,
          id: prefix + '/' + source.id,
          x: m[4],
          y: m[5],
          rotation: 0,
          transform: [m[0], m[1], m[2], m[3]],
          opacity: (instance.opacity ?? 1) * (source.opacity ?? 1),
          groups: [
            ...(instance.groups ?? []),
            ...(source.groups ?? []).map((g) => prefix + '/' + g),
          ],
        };
      }
      const lifetimes = new Map<
        string,
        { start: number; end: number; duration: number; firstFrame: number; identity: string }
      >();
      const buttons: RootButton[] = [];
      const artwork: { shape: Vector; button?: RootButton }[] = [];
      for (const pose of sampleGraphicButtonPlan(compiled.plan, frame)) {
        const shape = place(pose.shape, pose.layerId);
        if (!pose.button) {
          artwork.push({ shape });
          continue;
        }
        const span = active.get(JSON.stringify([pose.layerId, pose.shape.id]));
        if (!span) throw new Error('Missing movie-local button lifetime.');
        const epoch =
          span.start === 0 && span.end === duration
            ? 0
            : Math.floor((position - span.start) / duration);
        const buttonDefinition = definitions.get(shape.symbolId!)!;
        const poses = {} as RootButton['poses'];
        for (const state of ['up', 'over', 'down', 'hit'] as const)
          poses[state] = expandSymbols(project, [
            {
              ...shape,
              symbolPlayback: { mode: 'single', firstFrame: buttonDefinition.buttonStates![state] },
            },
          ]);
        const button: RootButton = {
          token: JSON.stringify([
            layerId,
            instance.id,
            definition.id,
            origin,
            span.id,
            span.start,
            span.end,
            epoch,
          ]),
          start: 0,
          end: project.duration,
          name: buttonDefinition.name,
          layerId,
          shape,
          poses,
        };
        lifetimes.set(button.token, {
          start: span.start,
          end: span.end,
          duration,
          firstFrame: Math.min(instance.symbolPlayback.firstFrame, duration - 1),
          identity: span.id,
        });
        buttons.push(button);
        artwork.push({ shape, button });
      }
      return {
        buttons,
        lifetimes,
        render(
          over: string | null,
          down: string | null,
          animated?: Map<string, Vector[]>,
        ): Vector[] {
          return artwork.flatMap(({ shape, button }) =>
            button
              ? (animated?.get(button.token) ??
                button.poses[
                  button.token === down ? 'down' : button.token === over ? 'over' : 'up'
                ])
              : [shape],
          );
        },
      };
    },
  };
}

/** Stage routing across graphic and independently clocked movie scopes. */
export function createInteractiveButtonView(
  project: Project,
  options: { layerPresentation?: boolean } = {},
) {
  const layerPresentation = options.layerPresentation === true;
  const viewStamp = layerPresentation ? selectionTrajectoryStamp(project) : '';
  if (layerPresentation) validateProject(project);
  const root = createGraphicButtonView(project);
  const movies = createMovieButtonViewBank(project);
  const children = createButtonChildViewBank(project);
  let capturing: { invalid: boolean } | undefined;
  function sample(
    frame: number,
    frames: Record<string, number>,
    origins: Record<string, number>,
    over: string | null = null,
    down: string | null = null,
    sampleState?: (button: RootButton, rootExposure: boolean, movieEntrySeconds?: number) => {
      frames: Record<string, number>;
      origins: Record<string, number>;
      entrySeconds?: number;
    },
  ) {
    const operation = capturing;
    const originalStamp = viewStamp;
    if (layerPresentation && selectionTrajectoryStamp(project) !== viewStamp)
      throw Error('Presentation source changed. Recreate this view.');
    if (layerPresentation) {
      if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
        throw Error('Choose an exact presentation frame.');
      admitPresentationClock(frames);
      admitPresentationClock(origins, true);
    }
    const rootClockStamp = layerPresentation ? selectionTrajectoryStamp([frames, origins]) : '';
    const snapshot = root.sample(frame);
    const placeholders = new Map(snapshot.buttons.map((b) => [b.token, [b.shape]]));
    const resolved = snapshot.render(null, null, placeholders);
    const buttons: RootButton[] = [];
    type Paint = { shape: Vector; button?: RootButton; children?: Paint[] };
    const states = new Map<
      string,
      { frames: Record<string, number>; origins: Record<string, number> }
    >();
    const placementEntries = new Map<RootButton, number>();
    let visits = 0;
    function descend(
      shapes: Vector[],
      layerId: string,
      available: RootButton[],
      depth: number,
      owner?: RootButton,
    ): Paint[] {
      if (depth > 8) throw new Error('Movie button routing depth exceeded.');
      const byId = new Map(available.map((b) => [b.shape.id, b]));
      return shapes.map((shape) => {
        if (++visits > 100000) throw new Error('Movie button routing work budget exceeded.');
        const button = byId.get(shape.id);
        if (button) {
          buttons.push(button);
          const local = children.sample(
            button,
            button.token === down ? 'down' : button.token === over ? 'over' : 'up',
          );
          if (sampleState) {
            const state = sampleState(button, depth === 0, placementEntries.get(button));
            states.set(button.token, { frames: state.frames, origins: state.origins });
            if (state.entrySeconds !== undefined)
              for (const child of local.buttons) placementEntries.set(child, state.entrySeconds);
          }
          if (!local.buttons.length && !sampleState) return { shape, button };
          const placeholders = new Map(local.buttons.map((b) => [b.token, [b.shape]]));
          return {
            shape,
            button,
            children: descend(
              local.render(null, null, placeholders),
              layerId,
              local.buttons,
              depth + 1,
              button,
            ),
          };
        }
        const path = owner
          ? 'root/preview' + shape.id.slice(owner.shape.id.length) + '/' + shape.symbolId
          : layerId + '/' + shape.id + '/' + shape.symbolId;
        const clock = owner ? states.get(owner.token) : { frames, origins };
        if (
          shape.kind === 'symbol' &&
          shape.symbolPlayback?.mode === 'movie' &&
          clock?.frames[path] !== undefined &&
          clock.origins[path] !== undefined
        ) {
          const local = movies.sample(shape, layerId, clock.frames[path], clock.origins[path]);
          const placeholders = new Map(local.buttons.map((b) => [b.token, [b.shape]]));
          const scoped = owner
            ? local.buttons.map((b) => ({
                ...b,
                token: JSON.stringify([
                  'state-movie',
                  owner.token,
                  project.symbols!.find((d) => d.id === owner.shape.symbolId)!.buttonStates![
                    owner.token === down ? 'down' : owner.token === over ? 'over' : 'up'
                  ],
                  b.token,
                ]),
              }))
            : local.buttons;
          if (sampleState) local.buttons.forEach((button, i) => {
            const span = local.lifetimes.get(button.token)!;
            placementEntries.set(scoped[i], movieButtonEntrySeconds(span.start, span.end, span.duration,
              span.firstFrame, clock.frames[path], clock.origins[path], project.fps));
          });
          return {
            shape,
            children: descend(
              local.render(null, null, placeholders),
              layerId,
              scoped,
              depth + 1,
              owner,
            ),
          };
        }
        return { shape };
      });
    }
    const layers = resolved.layers.map((layer) => ({
      layer,
      paint: descend(
        layer.keys[0].shapes,
        layer.id,
        snapshot.buttons.filter((b) => b.layerId === layer.id),
        0,
      ),
    }));
    const signature = JSON.stringify([over, down, frames, [...states]]);
    function render(
      over: string | null,
      down: string | null,
      animated?: Map<string, Vector[]>,
      stateFrames?: Map<string, Record<string, number>>,
      source = project,
      resolvedLayers = layers,
    ): Project {
      function paint(items: Paint[], parent?: RootButton): Vector[] {
        return items.flatMap(({ shape, button, children }) => {
          if (children) return paint(children, button ?? parent);
          if (button)
            return (
              animated?.get(button.token) ??
              button.poses[button.token === down ? 'down' : button.token === over ? 'over' : 'up']
            );
          if (parent && shape.kind === 'symbol')
            return expandSymbols(
              source,
              [shape],
              0,
              (movie) =>
                stateFrames?.get(parent.token)?.[
                  'root/preview' + movie.id.slice(parent.shape.id.length) + '/' + movie.symbolId
                ] ?? 0,
            );
          return [shape];
        });
      }
      return {
        ...source,
        layers: resolvedLayers.map(({ layer, paint: items }) => ({
          ...layer,
          keys: [{ frame: 0, shapes: paint(items) }],
        })),
      };
    }
    const clockStamp = layerPresentation
      ? selectionTrajectoryStamp([frames, origins, [...states]])
      : '';
    const checkCaptured = () => {
      if (operation?.invalid) throw Error('Resolved discovery reentered. Sample a fresh view.');
      if (
        selectionTrajectoryStamp(project) !== originalStamp ||
        selectionTrajectoryStamp([frames, origins]) !== rootClockStamp ||
        selectionTrajectoryStamp([frames, origins, [...states]]) !== clockStamp
      )
        throw Error('Resolved presentation source or clocks changed. Sample a fresh view.');
    };
    const privateLayers = layerPresentation ? detachPresentationData(layers) : undefined;
    const privateButtons = layerPresentation ? detachPresentationData(buttons) : undefined;
    if (layerPresentation) checkCaptured();
    let presenting = false,
      invalid = false;
    return {
      buttons,
      signature,
      render(
        over: string | null,
        down: string | null,
        animated?: Map<string, Vector[]>,
        stateFrames?: Map<string, Record<string, number>>,
      ) {
        return render(over, down, animated, stateFrames);
      },
      /** Opt-in render-only capture reuses this discovery and its sampled banks;
       * it never samples/prunes a clock per layer or for another consumer. */
      presentation(
        animated?: Map<string, Vector[]>,
        stateFrames?: Map<string, Record<string, number>>,
      ) {
        if (!privateLayers || !privateButtons)
          throw Error('Enable layerPresentation when creating this view.');
        if (presenting || invalid) {
          invalid = true;
          throw Error('Sample a fresh resolved presentation.');
        }
        presenting = true;
        try {
          checkCaptured();
          const artwork = capturePresentationBank(animated),
            clocks = capturePresentationBank(
              stateFrames ?? new Map([...states].map(([token, state]) => [token, state.frames])),
            );
          for (const [token, state] of states) {
            admitPresentationClock(state.frames);
            admitPresentationClock(state.origins, true);
            const current = clocks?.get(token);
            if (
              !current ||
              selectionTrajectoryStamp(current) !== selectionTrajectoryStamp(state.frames)
            )
              throw Error('Presentation state clocks must match this complete discovery.');
          }
          for (const clock of clocks?.values() ?? []) admitPresentationClock(clock);
          const source = detachPresentationData(project);
          checkCaptured();
          const result = detachLayerPresentation(
            render(over, down, artwork, clocks, source, privateLayers),
            frame,
            frames,
            privateButtons,
            signature,
          );
          checkCaptured();
          if (invalid) throw Error('Resolved presentation reentered. Sample a fresh view.');
          return result;
        } catch (cause) {
          invalid = true;
          throw cause;
        } finally {
          presenting = false;
        }
      },
    };
  }
  function guardedSample(...args: Parameters<typeof sample>) {
    if (capturing) {
      capturing.invalid = true;
      throw Error('Resolved discovery cannot reenter.');
    }
    const owner = { invalid: false };
    capturing = owner;
    try {
      return sample(...args);
    } finally {
      if (capturing === owner) capturing = undefined;
    }
  }
  return { sample: layerPresentation ? guardedSample : sample };
}
