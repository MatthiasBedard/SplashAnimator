import { validateProject, type Project, type FrameScript } from './index';

export type SymbolFrameSourceRequest = { symbolId: string; frame: number; source: string | null };
export type SymbolFrameSourceState = { project: Project; revision: number };

/** Reject executable serialization/accessors before original-value validation or cloning.
 * This stricter preparation scope owns plain saved document data, never a public preview. */
function signature(value: unknown): string {
  const visiting = new Set<object>();
  function inspect(value: unknown): void {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || visiting.has(value))
      throw new Error('Invalid original frame source data.');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
      throw new Error('Frame source preparation requires plain saved data.');
    visiting.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++)
        if (!Object.hasOwn(value, i)) throw new Error('Sparse original frame source data.');
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || !('value' in descriptor) || key === 'toJSON')
        throw new Error('Executable original frame source data.');
      inspect(descriptor.value);
    }
    visiting.delete(value);
  }
  inspect(value);
  return JSON.stringify(value);
}

/** Capture original project/library/revision ownership. Candidates do not publish or run code.
 * The caller must re-admit its enclosing context and stage publication/history itself. */
export function captureSymbolFrameSources(read: () => SymbolFrameSourceState) {
  let reading = false,
    busy = false,
    disposed = false;
  function state(): SymbolFrameSourceState {
    if (disposed || reading) throw new Error('Frame source owner is unavailable or reentered.');
    reading = true;
    try {
      const value = read(),
        project = value.project,
        revision = value.revision;
      if (disposed) throw new Error('Frame source owner was disposed during admission.');
      if (!Number.isSafeInteger(revision) || revision < 0)
        throw new Error('Invalid frame source revision.');
      return { project, revision };
    } finally {
      reading = false;
    }
  }
  const initial = state(),
    stamp = signature(initial.project);
  const original = validateProject(initial.project);
  function current(): void {
    const next = state();
    if (
      next.project !== initial.project ||
      next.revision !== initial.revision ||
      signature(next.project) !== stamp
    )
      throw new Error('Symbol frame source changed. Capture it again.');
  }
  current();
  return {
    prepare(requests: readonly SymbolFrameSourceRequest[]): Project {
      if (busy || reading || disposed)
        throw new Error('Frame source owner is unavailable or reentered.');
      busy = true;
      try {
        current();
        if (!Array.isArray(requests) || requests.length === 0 || requests.length > 10000)
          throw new Error('Invalid symbol frame source request count.');
        const snapshot: SymbolFrameSourceRequest[] = [],
          targets = new Set<string>();
        for (const request of requests) {
          if (!request || typeof request !== 'object' || Array.isArray(request))
            throw new Error('Invalid symbol frame source request.');
          const symbolId = request.symbolId,
            frame = request.frame,
            source = request.source;
          const definition = original.symbols?.find((symbol) => symbol.id === symbolId);
          if (typeof symbolId !== 'string' || !definition?.timeline)
            throw new Error('Choose an existing original symbol timeline.');
          if (!Number.isSafeInteger(frame) || frame < 0 || frame >= definition.timeline.duration)
            throw new Error('Invalid symbol-local frame source position.');
          if (
            source !== null &&
            (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 256 * 1024)
          )
            throw new Error('Invalid symbol frame source body.');
          const key = JSON.stringify([symbolId, frame]);
          if (targets.has(key)) throw new Error('Duplicate symbol frame source target.');
          targets.add(key);
          snapshot.push({ symbolId, frame, source });
        }
        current();
        const candidate = validateProject(original);
        for (const { symbolId, frame, source } of snapshot) {
          const timeline = candidate.symbols!.find((symbol) => symbol.id === symbolId)!.timeline!;
          const entries: FrameScript[] = (timeline.frameScripts ?? []).filter(
            (entry) => entry.frame !== frame,
          );
          if (source !== null) entries.push({ frame, source });
          entries.sort((a, b) => a.frame - b.frame);
          if (entries.length) timeline.frameScripts = entries;
          else delete timeline.frameScripts;
        }
        const result = validateProject(candidate);
        current();
        return result;
      } finally {
        busy = false;
      }
    },
    /** Final caller-side publication admission; does not adopt returned candidates. */
    assertCurrent(): void {
      if (busy || reading) throw new Error('Frame source owner reentered.');
      current();
    },
    dispose(): void {
      disposed = true;
    },
  };
}

export type IsolatedSymbolFrameSourceState = SymbolFrameSourceState & {
  definition: import('./index').SymbolDefinition;
  frame: number;
  /** Caller-owned local context/library/history admission, captured once. */
  validateEnclosing: () => void;
};

/** Source-only isolated draft adapter. Returns a definition, never publishes it.
 * The enclosing project supplies real root source/assets/library budgets. */
export function captureIsolatedSymbolFrameSources(read: () => IsolatedSymbolFrameSourceState) {
  let reading = false,
    preparing = false,
    admitting = false,
    disposed = false;
  let capturedValidator: (() => void) | undefined;
  function state(): IsolatedSymbolFrameSourceState {
    if (disposed || reading)
      throw new Error('Isolated frame source owner unavailable or reentered.');
    reading = true;
    try {
      const value = read();
      const project = value.project,
        revision = value.revision,
        definition = value.definition,
        frame = value.frame,
        validateEnclosing = capturedValidator ?? value.validateEnclosing;
      if (
        disposed ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        typeof validateEnclosing !== 'function'
      )
        throw new Error('Invalid isolated frame source ownership.');
      capturedValidator = validateEnclosing;
      return { project, revision, definition, frame, validateEnclosing };
    } finally {
      reading = false;
    }
  }
  const initial = state(),
    stamp = signature(initial.definition),
    verify = initial.validateEnclosing;
  if (
    !initial.definition?.timeline ||
    !Number.isSafeInteger(initial.frame) ||
    initial.frame < 0 ||
    initial.frame >= initial.definition.timeline.duration
  )
    throw new Error('Choose an existing original symbol timeline frame.');
  const enclosing = captureSymbolFrameSources(() => {
    const value = state();
    return { project: value.project, revision: value.revision };
  });
  function current() {
    if (admitting) throw new Error('Isolated frame source admission reentered.');
    admitting = true;
    try {
      const value = state();
      if (
        value.definition !== initial.definition ||
        value.frame !== initial.frame ||
        value.revision !== initial.revision ||
        signature(value.definition) !== stamp
      )
        throw new Error('Isolated symbol frame source changed. Reopen the source editor.');
      const result = verify() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw new Error('Isolated source admission must be synchronous.');
      }
      enclosing.assertCurrent();
      const after = state();
      if (
        after.definition !== initial.definition ||
        after.frame !== initial.frame ||
        after.revision !== initial.revision ||
        signature(after.definition) !== stamp
      )
        throw new Error('Isolated symbol frame source changed during admission.');
    } finally {
      admitting = false;
    }
  }
  current();
  if (!initial.project.symbols?.some((symbol) => symbol.id === initial.definition.id))
    throw new Error('Missing enclosing symbol definition.');
  const working = validateProject({
    ...initial.project,
    symbols: initial.project.symbols.map((symbol) =>
      symbol.id === initial.definition.id ? initial.definition : symbol,
    ),
  });
  current();
  const candidateOwner = captureSymbolFrameSources(() => ({ project: working, revision: 0 }));
  return {
    /** Detached owned data for program preparation, never an alternative public source. */
    snapshot(){
      if(preparing||reading||admitting||disposed)throw new Error('Isolated frame source owner unavailable or reentered.');
      current();const project=validateProject(working);current();
      return {project,definition:project.symbols!.find(symbol=>symbol.id===initial.definition.id)!,frame:initial.frame,revision:initial.revision};
    },
    prepare(source: string | null) {
      if (preparing || admitting || reading || disposed)
        throw new Error('Isolated frame source owner unavailable or reentered.');
      preparing = true;
      try {
        current();
        const candidate = candidateOwner.prepare([
          { symbolId: initial.definition.id, frame: initial.frame, source },
        ]);
        const definition = candidate.symbols!.find(
          (symbol) => symbol.id === initial.definition.id,
        )!;
        current();
        return definition;
      } finally {
        preparing = false;
      }
    },
    assertCurrent() {
      if (preparing || admitting || reading || disposed)
        throw new Error('Isolated frame source owner unavailable or reentered.');
      current();
    },
    dispose() {
      disposed = true;
      enclosing.dispose();
      candidateOwner.dispose();
    },
  };
}
