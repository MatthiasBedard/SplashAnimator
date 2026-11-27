import { symbolLayers, type Project, type Vector } from '../../document/src';
import { matrix, multiply } from '../../geometry/src/affine';
import { expandSymbols } from '../../geometry/src/symbols';
import { type RootButton } from './button-preview';
import { compileGraphicButtonPlan, sampleGraphicButtonPlan } from './graphic-button-plan';

export function buttonChildToken(parent: string, frame: number, layer: string, path: string,
  exposures: readonly (readonly [string, number, number])[]) {
  return JSON.stringify(['button-child', parent, frame, layer, path, exposures]);
}

/** Cached mapped-state discovery for recursive button routing. Movies remain clock-scope leaves.
 * The caller owns parent state transitions and supplies the parent's current lifetime token.
 */
export function createButtonChildViewBank(project: Project) {
  const definitions = new Map(project.symbols?.map((d) => [d.id, d]));
  const plans = new Map<string, ReturnType<typeof compileGraphicButtonPlan>>();
  return {
    sample(parent: RootButton, state: 'up' | 'over' | 'down') {
      const definition = definitions.get(parent.shape.symbolId!);
      if (parent.shape.kind !== 'symbol' || !definition?.buttonStates)
        throw new Error('Choose a button parent.');
      let plan = plans.get(definition.id);
      if (!plan) {
        plan = compileGraphicButtonPlan({
          ...project,
          duration: definition.timeline?.duration ?? 1,
          layers: symbolLayers(definition),
        });
        plans.set(definition.id, plan);
      }
      const frame = definition.buttonStates[state];
      const basis = multiply(matrix(parent.shape), [
        definition.width ? parent.shape.width / definition.width : 1,
        0,
        0,
        definition.height ? parent.shape.height / definition.height : 1,
        0,
        0,
      ]);
      const buttons: RootButton[] = [];
      const artwork = sampleGraphicButtonPlan(plan, frame).map((pose) => {
        const prefix = parent.shape.id + (pose.layerId === '@base' ? '' : '/' + pose.layerId);
        const m = multiply(basis, matrix(pose.shape));
        const shape: Vector = {
          ...pose.shape,
          id: prefix + '/' + pose.shape.id,
          x: m[4],
          y: m[5],
          rotation: 0,
          transform: [m[0], m[1], m[2], m[3]],
          opacity: (parent.shape.opacity ?? 1) * (pose.shape.opacity ?? 1),
          groups: [
            ...(parent.shape.groups ?? []),
            ...(pose.shape.groups ?? []).map((g) => prefix + '/' + g),
          ],
        };
        if (!pose.button) return { shape };
        const child = definitions.get(shape.symbolId!)!;
        const poses = {} as RootButton['poses'];
        for (const state of ['up', 'over', 'down', 'hit'] as const)
          poses[state] = expandSymbols(project, [
            {
              ...shape,
              symbolPlayback: { mode: 'single', firstFrame: child.buttonStates![state] },
            },
          ]);
        const button: RootButton = {
          token: buttonChildToken(parent.token, frame, pose.layerId, pose.shape.id,
            pose.exposures.map((e) => [e.path, e.start, e.end])),
          start: parent.start,
          end: parent.end,
          layerId: parent.layerId,
          name: child.name,
          shape,
          poses,
        };
        buttons.push(button);
        return { shape, button };
      });
      return {
        frame,
        buttons,
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
