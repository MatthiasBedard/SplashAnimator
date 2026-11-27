export type PNGFileStream = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};
export type PNGFileHandle = { createWritable: () => Promise<PNGFileStream> };

/** Release temporary output without letting a stalled platform abort lock the editor. */
export async function discardPNGWritable(stream: PNGFileStream): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => stream.abort()),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 60000); }),
    ]);
  } catch { /* Already failed/closed streams may reject abort. */ }
  finally { clearTimeout(timer); }
}

/** A late writable is discarded, never exposed to the caller after cancellation. */
export async function openPNGWritable(handle: PNGFileHandle, signal: AbortSignal): Promise<PNGFileStream> {
  signal.throwIfAborted();
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const opening = Promise.resolve().then(() => { signal.throwIfAborted(); return handle.createWritable(); }).then(stream => {
    if (abandoned || signal.aborted) {
      void discardPNGWritable(stream);
      throw signal.reason ?? new Error('PNG file opening expired.');
    }
    return stream;
  });
  try {
    return await Promise.race([opening, new Promise<never>((_, reject) => {
      abort = () => { abandoned = true; reject(signal.reason ?? new DOMException('PNG export cancelled.', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => { abandoned = true; reject(new Error('PNG file opening timed out.')); }, 60000);
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}
