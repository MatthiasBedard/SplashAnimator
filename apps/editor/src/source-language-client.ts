import type {
  FrameLanguageRequest,
  FrameLanguageReply,
} from '../../../packages/scripting/src/language-service';
/** One editor owns its worker and pending requests. Editing/closing cannot retain stale results. */
export function createSourceLanguageClient() {
  let worker: Worker | undefined,
    serial = 0,
    generation = 0,
    disposed = false;
  const pending = new Map<
    number,
    {
      resolve: (value: FrameLanguageReply) => void;
      reject: (reason: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
      kind: FrameLanguageRequest['kind'];
    }
  >();
  function cancel(reason: unknown = new Error('Source language request cancelled.')) {
    generation++;
    worker?.terminate();
    worker = undefined;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(reason);
    }
    pending.clear();
  }
  function start() {
    if (worker) return worker;
    const owned = generation;
    const next = new Worker(
      new URL('../../../packages/scripting/src/language-worker.ts', import.meta.url),
      { type: 'module', name: 'splash-source-language' },
    );
    if (disposed || owned !== generation) {
      next.terminate();
      throw new Error('Source language editor is closed.');
    }
    worker = next;
    next.onmessage = (event) => {
      if (worker !== next) return;
      const { id, result, error } = event.data ?? {},
        job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      if (typeof error === 'string') job.reject(new Error(error.slice(0, 2000)));
      else if (
        result &&
        typeof result === 'object' &&
        result.kind === job.kind &&
        validReply(result)
      )
        job.resolve(result as FrameLanguageReply);
      else job.reject(new Error('Invalid source language response.'));
    };
    next.onerror = (event) => {
      event.preventDefault();
      if (worker === next) cancel(new Error('Source language worker failed.'));
    };
    return next;
  }
  return Object.freeze({
    async request(request: FrameLanguageRequest) {
      if (disposed) return Promise.reject(new Error('Source language editor is closed.'));
      if (pending.size >= 8) return Promise.reject(new Error('Source language requests are busy.'));
      const { kind, source, offset } = request;
      if (
        !['complete', 'hover', 'diagnostics'].includes(kind) ||
        typeof source !== 'string' ||
        source.length > 256 * 1024 ||
        new TextEncoder().encode(source).byteLength > 256 * 1024 ||
        (offset !== undefined &&
          (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length)) ||
        (kind !== 'diagnostics' && offset === undefined)
      )
        return Promise.reject(new Error('Invalid source language request.'));
      const captured = { kind, source, ...(offset === undefined ? {} : { offset }) };
      const id = ++serial;
      return new Promise<FrameLanguageReply>((resolve, reject) => {
        const timer = setTimeout(
          () => cancel(new Error('Source language request timed out.')),
          4000,
        );
        pending.set(id, { resolve, reject, timer, kind });
        try {
          start().postMessage({ id, request: captured });
        } catch (error) {
          cancel(error);
        }
      });
    },
    cancel,
    dispose() {
      if (!disposed) {
        disposed = true;
        cancel();
      }
    },
  });
}

function validReply(value: FrameLanguageReply) {
  if (value.kind === 'hover') return typeof value.text === 'string' && value.text.length <= 2000;
  if (value.kind === 'complete')
    return (
      Array.isArray(value.items) &&
      value.items.length <= 100 &&
      Array.from(value.items).every(
        (item) =>
          item &&
          typeof item.label === 'string' &&
          item.label.length <= 128 &&
          typeof item.kind === 'string' &&
          item.kind.length <= 128,
      )
    );
  return (
    Array.isArray(value.diagnostics) &&
    value.diagnostics.length <= 50 &&
    Array.from(value.diagnostics).every(
      (d) =>
        d &&
        Number.isSafeInteger(d.code) &&
        Number.isSafeInteger(d.line) &&
        d.line >= 1 &&
        Number.isSafeInteger(d.column) &&
        d.column >= 1 &&
        typeof d.message === 'string' &&
        d.message.length <= 2000,
    )
  );
}
