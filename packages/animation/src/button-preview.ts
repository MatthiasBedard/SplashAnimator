import {
  compileGraphicButtonPlan,
  compileGraphicButtonLifetimes,
  sampleGraphicButtonPlan,
  graphicButtonLifetimesAt,
} from './graphic-button-plan';
import { keyAt, type Project, type Vector, type Point } from '../../document/src';
import { expandSymbols, expandStaticButtonContainers } from '../../geometry/src/symbols';
import { hit } from '../../geometry/src';
import { createButtonStateClock, compileButtonStatePlans } from './button-state-clock';

export type RootButton = {
  token: string;
  start: number;
  end: number;
  name: string;
  layerId: string;
  shape: Vector;
  poses: Record<'up' | 'over' | 'down' | 'hit', Vector[]>;
};

/** Root exposures are distinct interaction lifetimes; these base poses also supply frozen Hit artwork. */
export function rootButtons(project: Project, frame: number): RootButton[] {
  const definitions = new Map(project.symbols?.map((d) => [d.id, d]));
  return project.layers
    .filter((l) => l.visible)
    .flatMap((layer) => {
      const key = keyAt(layer, frame);
      return expandStaticButtonContainers(project, key.shapes).flatMap((shape) => {
        const definition = shape.kind === 'symbol' ? definitions.get(shape.symbolId!) : undefined;
        if (!definition?.buttonStates) return [];
        const poses = {} as RootButton['poses'];
        for (const name of ['up', 'over', 'down', 'hit'] as const) {
          poses[name] = expandSymbols(project, [
            {
              ...shape,
              symbolPlayback: { mode: 'single', firstFrame: definition.buttonStates[name] },
            },
          ]);
        }
        return [
          {
            token: JSON.stringify([layer.id, key.frame, shape.id, shape.symbolId]),
            start: key.frame,
            end: layer.keys.find((k) => k.frame > key.frame)?.frame ?? project.duration,
            name: definition.name,
            layerId: layer.id,
            shape,
            poses,
          },
        ];
      });
    });
}

export function pickRootButton(buttons: RootButton[], point: Point): RootButton | undefined {
  return [...buttons]
    .reverse()
    .find((button) => button.poses.hit.some((shape) => hit(shape, point, 0)));
}

/** Detached render-only view; authoring project and clock topology remain untouched. */
export function rootButtonProject(
  project: Project,
  frame: number,
  buttons: RootButton[],
  over: string | null,
  down: string | null,
  animated?: Map<string, Vector[]>,
): Project {
  if (!buttons.length) return project;
  const byLayer = new Map<string, Map<string, RootButton>>();
  for (const button of buttons) {
    if (!byLayer.has(button.layerId)) byLayer.set(button.layerId, new Map());
    byLayer.get(button.layerId)!.set(button.shape.id, button);
  }
  return {
    ...project,
    layers: project.layers.map((layer) => {
      const mapped = byLayer.get(layer.id);
      if (!mapped) return layer;
      const current = keyAt(layer, frame);
      return {
        ...layer,
        keys: layer.keys.map((key) =>
          key !== current
            ? key
            : {
                ...key,
                shapes: expandStaticButtonContainers(project, key.shapes).flatMap((shape) => {
                  const button = mapped.get(shape.id);
                  return button
                    ? (animated?.get(button.token) ??
                        button.poses[
                          button.token === down ? 'down' : button.token === over ? 'over' : 'up'
                        ])
                    : [shape];
                }),
              },
        ),
      };
    }),
  };
}

/** One independent nested-clock session per visible root-button exposure. */
export function createRootButtonMoviePlayback() {
  type Session = {
    clock: ReturnType<typeof createButtonStateClock>;
    signature: string;
    shapes: Vector[];
  };
  const sessions = new Map<string, Session>();
  const plans = new Map<string, ReturnType<typeof compileButtonStatePlans>>();
  let source: Project | undefined;
  return {
    entrySeconds: (token: string) => sessions.get(token)?.clock.entrySeconds(),
    reset() {
      sessions.clear();
      plans.clear();
      source = undefined;
    },
    invalidate(tokens: Set<string>) {
      for (const token of tokens) sessions.delete(token);
    },
    sample(
      project: Project,
      buttons: RootButton[],
      over: string | null,
      down: string | null,
      seconds: number,
      prune = true,
      entrySeconds?: number,
    ) {
      if (source !== project) {
        sessions.clear();
        plans.clear();
        source = project;
      }
      const active = new Set(buttons.map((button) => button.token));
      if (prune)
        for (const token of sessions.keys()) if (!active.has(token)) sessions.delete(token);
      const stateFrames = new Map<string, Record<string, number>>();
      const stateOrigins = new Map<string, Record<string, number>>();
      const artwork = new Map<string, Vector[]>(),
        signatures: string[] = [];
      for (const button of buttons) {
        const definition = project.symbols!.find((d) => d.id === button.shape.symbolId)!;
        const frame =
          definition.buttonStates![
            button.token === down ? 'down' : button.token === over ? 'over' : 'up'
          ];
        let session = sessions.get(button.token);
        if (!session) {
          if (!plans.has(definition.id))
            plans.set(
              definition.id,
              compileButtonStatePlans(definition, project.symbols!, project.fps),
            );
          session = {
            clock: createButtonStateClock(
              definition,
              project.symbols!,
              project.fps,
              plans.get(definition.id)!,
            ),
            signature: '',
            shapes: [],
          };
          sessions.set(button.token, session);
          if (entrySeconds !== undefined && button.token !== over && button.token !== down)
            session.clock.sample(frame, entrySeconds);
        }
        const frames = session.clock.sample(frame, seconds);
        stateFrames.set(button.token, frames);
        stateOrigins.set(button.token, session.clock.origins());
        const signature = JSON.stringify([frame, frames, button.shape]);
        if (signature !== session.signature) {
          session.shapes = expandSymbols(
            project,
            [{ ...button.shape, symbolPlayback: { mode: 'single', firstFrame: frame } }],
            0,
            (shape) =>
              frames[
                'root/preview' + shape.id.slice(button.shape.id.length) + '/' + shape.symbolId
              ] ?? 0,
          );
          session.signature = signature;
        }
        artwork.set(button.token, session.shapes);
        signatures.push(button.token + signature);
      }
      return { artwork, stateFrames, stateOrigins, signature: JSON.stringify(signatures) };
    },
  };
}

/** Compile once per immutable project revision; sample poses and lifetimes together.
 * The detached project keeps movie paths intact for the existing movie clock.
 */
export function createGraphicButtonView(project: Project) {
  const plan = compileGraphicButtonPlan(project);
  const lifetimes = compileGraphicButtonLifetimes(plan);
  const definitions = new Map(project.symbols?.map((d) => [d.id, d]));
  return {
    sample(frame: number) {
      const resolved = sampleGraphicButtonPlan(plan, frame);
      const active = new Map(
        graphicButtonLifetimesAt(lifetimes, project.duration, frame).map((span) => [
          JSON.stringify([span.layerId, span.path]),
          span,
        ]),
      );
      const buttons: RootButton[] = [];
      for (const pose of resolved) {
        if (!pose.button) continue;
        const span = active.get(JSON.stringify([pose.layerId, pose.shape.id]));
        if (!span) throw new Error('Missing compiled button lifetime.');
        const definition = definitions.get(pose.shape.symbolId!)!;
        const poses = {} as RootButton['poses'];
        for (const name of ['up', 'over', 'down', 'hit'] as const)
          poses[name] = expandSymbols(project, [
            {
              ...pose.shape,
              symbolPlayback: { mode: 'single', firstFrame: definition.buttonStates![name] },
            },
          ]);
        buttons.push({
          token: span.id,
          start: span.start,
          end: span.end,
          name: definition.name,
          layerId: pose.layerId,
          shape: pose.shape,
          poses,
        });
      }
      return {
        buttons,
        render(
          over: string | null,
          down: string | null,
          animated?: Map<string, Vector[]>,
        ): Project {
          const byLayer = new Map<string, Vector[]>();
          const byPath = new Map(buttons.map((b) => [JSON.stringify([b.layerId, b.shape.id]), b]));
          for (const pose of resolved) {
            const button = byPath.get(JSON.stringify([pose.layerId, pose.shape.id]));
            let shapes = byLayer.get(pose.layerId);
            if (!shapes) byLayer.set(pose.layerId, (shapes = []));
            shapes.push(
              ...(button
                ? (animated?.get(button.token) ??
                  button.poses[
                    button.token === down ? 'down' : button.token === over ? 'over' : 'up'
                  ])
                : [pose.shape]),
            );
          }
          return {
            ...project,
            layers: project.layers.map((layer) => ({
              ...layer,
              keys: [{ frame: 0, shapes: byLayer.get(layer.id) ?? [] }],
            })),
          };
        },
      };
    },
  };
}
