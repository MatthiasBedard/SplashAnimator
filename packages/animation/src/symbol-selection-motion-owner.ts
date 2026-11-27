import {
  newProject,
  symbolLayers,
  validateProject,
  type Project,
  type SymbolDefinition,
  type Point,
} from '../../document/src';
import type { SymbolAuthoringSource } from './symbol-motion-owner';
import type { TrajectoryRequest } from './trajectory-input';
import { selectionTrajectoryStamp } from './selection-trajectory';
import {
  captureRememberedSelectionAuthoringFrame,
  type SampledUnitRequest,
  type SampledSelectionOptions,
  type SampledSelectionOwner,
  type SampledSelectionRotationOwner,
  type SampledSelectionScaleOwner,
  type SampledSelectionSkewOwner,
} from './selection-motion-owner';

/** Separate from legacy symbol captures: complete original resource metadata is
 * required so project validation never invents assets for library artwork. */
export interface SymbolSelectionAuthoringSource extends SymbolAuthoringSource {
  assets: Project['assets'];
}
export type SymbolSampledSelectionOwner = SampledSelectionOwner & { definitionId: string };
export type SymbolSampledSelectionRotationOwner = SampledSelectionRotationOwner & {
  definitionId: string;
};
export type SymbolSampledSelectionScaleOwner = SampledSelectionScaleOwner & {
  definitionId: string;
};
export type SymbolSampledSelectionSkewOwner = SampledSelectionSkewOwner & {
  definitionId: string;
};

function snapshot(source: SymbolSelectionAuthoringSource): SymbolSelectionAuthoringSource {
  return {
    definition: source.definition,
    symbols: source.symbols,
    assets: source.assets,
    revision: source.revision,
    frame: source.frame,
  };
}
function originalNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw Error('Sampled symbol selection contains nonfinite original values.');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) originalNumbers(child);
}
function signature(source: SymbolSelectionAuthoringSource): string {
  if (
    !source.definition ||
    !Array.isArray(source.symbols) ||
    !Array.isArray(source.assets) ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0 ||
    !Number.isSafeInteger(source.frame) ||
    source.frame < 0 ||
    source.frame >= (source.definition.timeline?.duration ?? 1)
  )
    throw Error(
      'Supply an original symbol definition, complete library/assets, revision and frame.',
    );
  originalNumbers(source);
  const ids = source.symbols.map((s) => s.id);
  if (new Set(ids).size !== ids.length || !ids.includes(source.definition.id))
    throw Error('Supply the complete original symbol library with one target identity.');
  return JSON.stringify([source.definition, source.symbols, source.assets]);
}

/** Private mixed-unit isolated selection. No draft/history writes; callers own
 * admission/publication of the complete enclosing project, assets and candidate. */
export function captureSymbolRememberedSelectionAuthoringFrame(
  readSource: () => SymbolSelectionAuthoringSource,
) {
  const initial = snapshot(readSource()),
    stamp = signature(initial);
  let dead = false,
    reading = false,
    working = false;
  let capture: ReturnType<typeof captureRememberedSelectionAuthoringFrame> | undefined;
  function dispose() {
    dead = true;
    capture?.dispose();
  }
  function current(expectedDataStamp?: string) {
    if (dead) throw Error('Sampled symbol selection capture is disposed or invalidated.');
    if (reading) {
      dispose();
      throw Error('Sampled symbol selection source cannot reenter.');
    }
    reading = true;
    try {
      const live = snapshot(readSource());
      if (
        dead ||
        live.definition !== initial.definition ||
        live.symbols !== initial.symbols ||
        live.assets !== initial.assets ||
        live.revision !== initial.revision ||
        live.frame !== initial.frame ||
        signature(live) !== stamp ||
        (expectedDataStamp !== undefined &&
          selectionTrajectoryStamp([live.definition, live.symbols, live.assets]) !==
            expectedDataStamp)
      )
        throw Error('Sampled symbol selection source changed. Sample the frame again.');
    } catch (error) {
      dispose();
      throw error;
    } finally {
      reading = false;
    }
  }
  function operation<T>(run: () => T): T {
    if (working) {
      dispose();
      throw Error('Sampled symbol selection preparation cannot reenter.');
    }
    current();
    working = true;
    try {
      return run();
    } catch (error) {
      if (!dead) current();
      throw error;
    } finally {
      working = false;
    }
  }
  function validator(options: SampledSelectionOptions) {
    if (!options || typeof options !== 'object')
      throw Error('Invalid sampled symbol selection options.');
    const validate = options.validate;
    if (validate !== undefined && typeof validate !== 'function')
      throw Error('Enclosing validation must be callable.');
    current();
    return () => {
      current();
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Enclosing validation must be synchronous.');
      }
      current();
    };
  }
  try {
    current();
    const definition = structuredClone(initial.definition);
    current();
    const symbols = structuredClone(initial.symbols);
    current();
    const assets = structuredClone(initial.assets);
    current();
    const library = [...symbols.filter((s) => s.id !== definition.id), definition];
    const project = newProject();
    // This header belongs only to the internal timeline adapter. Symbol bounds
    // admit zero/fractional/large values independently of root stage dimensions;
    // their original values are validated through the complete library below.
    project.duration = definition.timeline?.duration ?? 1;
    project.layers = structuredClone(symbolLayers(definition)).map((layer) => ({
      ...layer,
      drawingMode: layer.drawingMode ?? 'object',
    }));
    project.symbols = symbols;
    project.assets = assets;
    validateProject(project);
    current();
    project.symbols = library;
    validateProject(project);
    current();
    capture = captureRememberedSelectionAuthoringFrame(() => {
      current();
      return { project, revision: initial.revision, frame: initial.frame };
    });
    const owned = capture;
    function definitionFrom(candidate: Project): SymbolDefinition {
      const [base, ...additional] = candidate.layers;
      if (base.id !== '@base' || !definition.timeline)
        throw Error('Original animated symbol tracks changed.');
      return {
        ...definition,
        shapes: base.keys[0].shapes,
        timeline: {
          ...definition.timeline,
          keys: base.keys.slice(1),
          ...(definition.timeline.layers !== undefined
            ? {
                layers: additional.map((layer, i) => {
                  const next = { ...layer },
                    original = definition.timeline!.layers![i];
                  if (original.drawingMode === undefined) {
                    if (Object.prototype.hasOwnProperty.call(original, 'drawingMode'))
                      next.drawingMode = undefined;
                    else delete next.drawingMode;
                  }
                  return next;
                }),
              }
            : {}),
          ...(base.motionSpans !== undefined ? { motionSpans: base.motionSpans } : {}),
        },
      };
    }
    function admit(candidate: SymbolDefinition) {
      // Validate replacement aggregate artwork and real resource references in
      // the entire original library, including definitions not selected here.
      validateProject({
        ...project,
        layers: symbolLayers(candidate),
        symbols: [...symbols.filter((s) => s.id !== candidate.id), candidate],
      });
    }
    current();
    return {
      get scene() {
        return operation(() => {
          const out = owned.scene;
          current();
          return out;
        });
      },
      get choices() {
        return operation(() => {
          const out = owned.choices.map((c) => ({ ...c, definitionId: definition.id }));
          current();
          return out;
        });
      },
      resolveSelection(
        requests: readonly SampledUnitRequest[],
        options: SampledSelectionOptions = {},
      ): SymbolSampledSelectionOwner {
        return operation(() => {
          const active = validator(options),
            owner = owned.resolveSelection(requests, { validate: active });
          const out = structuredClone({ ...owner, definitionId: definition.id });
          active();
          return out;
        });
      },
      /** Replace whole original routes; no sampled promotion or split metadata.
       * Actual resources/enclosing admission and complete output ownership stay
       * private. The caller owns final enclosing project/history publication. */
      prepareTrajectories(
        requests: readonly SampledUnitRequest[],
        trajectories: readonly TrajectoryRequest[],
        options: SampledSelectionOptions = {},
      ): SymbolDefinition {
        return operation(() => {
          const sourceStamp = selectionTrajectoryStamp([definition, symbols, assets]);
          current(sourceStamp);
          const active = validator(options),
            candidate = owned.prepareTrajectories(requests, trajectories, { validate: active }),
            candidateStamp = selectionTrajectoryStamp(candidate);
          active();
          originalNumbers(candidate);
          validateProject(candidate);
          if (selectionTrajectoryStamp(candidate) !== candidateStamp)
            throw Error('Prepared isolated trajectories changed before conversion.');
          const converted = definitionFrom(candidate);
          originalNumbers(converted);
          admit(converted);
          const stamp = selectionTrajectoryStamp(converted),
            output = structuredClone(converted);
          active();
          originalNumbers(output);
          admit(output);
          if (selectionTrajectoryStamp(output) !== stamp)
            throw Error('Prepared isolated trajectories changed during conversion/cloning.');
          active();
          // Final enclosing/source reads can hold the detached candidate.
          originalNumbers(output);
          admit(output);
          current(sourceStamp);
          if (selectionTrajectoryStamp(output) !== stamp)
            throw Error('Prepared isolated trajectories changed during final admission.');
          return output;
        });
      },
      resolveRotation(
        requests: readonly SampledUnitRequest[],
        options: SampledSelectionOptions = {},
      ): SymbolSampledSelectionRotationOwner {
        return operation(() => {
          const active = validator(options),
            owner = owned.resolveRotation(requests, { validate: active });
          const out = structuredClone({ ...owner, definitionId: definition.id });
          active();
          return out;
        });
      },
      prepareRotation(
        requests: readonly SampledUnitRequest[],
        degrees: number,
        options: SampledSelectionOptions = {},
      ): SymbolDefinition {
        return operation(() => {
          const active = validator(options),
            candidate = owned.prepareRotation(requests, degrees, { validate: active });
          active();
          const converted = definitionFrom(candidate),
            stamp = JSON.stringify(converted),
            output = structuredClone(converted);
          active();
          admit(output);
          active();
          if (JSON.stringify(output) !== stamp)
            throw Error('Prepared isolated rotation changed during conversion/cloning.');
          current();
          return output;
        });
      },
      resolveScale(
        requests: readonly SampledUnitRequest[],
        options: SampledSelectionOptions = {},
      ): SymbolSampledSelectionScaleOwner {
        return operation(() => {
          const active = validator(options),
            owner = owned.resolveScale(requests, { validate: active });
          const out = structuredClone({ ...owner, definitionId: definition.id });
          active();
          return out;
        });
      },
      prepareScale(
        requests: readonly SampledUnitRequest[],
        scaleX: number,
        scaleY: number,
        options: SampledSelectionOptions = {},
      ): SymbolDefinition {
        return operation(() => {
          const active = validator(options),
            candidate = owned.prepareScale(requests, scaleX, scaleY, { validate: active });
          active();
          const converted = definitionFrom(candidate),
            stamp = JSON.stringify(converted),
            output = structuredClone(converted);
          active();
          admit(output);
          active();
          // The last enclosing callback may hold a detached output reference.
          // Admit complete raw data/resources again before returning it.
          originalNumbers(output);
          admit(output);
          current();
          if (JSON.stringify(output) !== stamp)
            throw Error('Prepared isolated scaling changed during conversion/cloning/admission.');
          return output;
        });
      },
      resolveSkew(
        requests: readonly SampledUnitRequest[],
        options: SampledSelectionOptions = {},
      ): SymbolSampledSelectionSkewOwner {
        return operation(() => {
          const active = validator(options),
            owner = owned.resolveSkew(requests, { validate: active });
          const out = structuredClone({ ...owner, definitionId: definition.id });
          active();
          return out;
        });
      },
      prepareSkew(
        requests: readonly SampledUnitRequest[],
        axis: 'x' | 'y',
        degrees: number,
        options: SampledSelectionOptions = {},
      ): SymbolDefinition {
        return operation(() => {
          const active = validator(options),
            candidate = owned.prepareSkew(requests, axis, degrees, { validate: active });
          active();
          const converted = definitionFrom(candidate),
            stamp = JSON.stringify(converted),
            output = structuredClone(converted);
          active();
          admit(output);
          active();
          // The last enclosing callback may hold a detached output reference.
          // Admit complete raw data/resources again before returning it.
          originalNumbers(output);
          admit(output);
          current();
          originalNumbers(output);
          if (JSON.stringify(output) !== stamp)
            throw Error('Prepared isolated shearing changed during conversion/cloning/admission.');
          return output;
        });
      },
      prepareTranslation(
        requests: readonly SampledUnitRequest[],
        offset: Point,
        options: SampledSelectionOptions = {},
      ): SymbolDefinition {
        return operation(() => {
          const active = validator(options),
            candidate = owned.prepareTranslation(requests, offset, { validate: active });
          active();
          const output = structuredClone(definitionFrom(candidate));
          active();
          admit(output);
          active();
          return output;
        });
      },
      assertCurrent() {
        operation(() => {
          owned.assertCurrent();
          current();
        });
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
