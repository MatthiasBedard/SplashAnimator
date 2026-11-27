import { selectionTrajectoryStamp } from '../packages/animation/src/selection-trajectory';

export function createReactiveStamp() {
  let project = $state<{ nested: { x: number; optional?: undefined } }>({ nested: { x: 1 } });
  const json = $derived(JSON.stringify(project));
  const lossless = $derived.by(() => {
    void json;
    return selectionTrajectoryStamp(project);
  });
  return {
    read: () => ({ json, lossless, actual: selectionTrajectoryStamp($state.snapshot(project)) }),
    add: () => {
      project.nested.optional = undefined;
    },
    remove: () => {
      delete project.nested.optional;
    },
    move: () => {
      project.nested.x++;
    },
    invalid: () => {
      project.nested.x = NaN;
    },
    replace: () => {
      project = { nested: { x: 7 } };
    },
  };
}
