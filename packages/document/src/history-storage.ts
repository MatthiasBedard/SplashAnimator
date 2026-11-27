/** Retained snapshot payload, shared by Undo and Redo for each editing history. */
export const HISTORY_BYTE_LIMIT = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Editor-owned JSON captured before an edit and decoded for detached preparation. */
export class HistoryCapture<T> {
  readonly #json: string;
  readonly snapshot: T;

  constructor(json: string) {
    this.snapshot = JSON.parse(json) as T;
    this.#json = json;
  }

  get json() { return this.#json; }
}

export class HistoryEntry<T> {
  readonly #payload: Uint8Array;
  readonly bytes: number;

  constructor(snapshot: T | HistoryCapture<T>, readonly label = '') {
    const text = snapshot instanceof HistoryCapture ? snapshot.json : JSON.stringify(snapshot);
    if (text === undefined) throw Error('Invalid history snapshot.');
    this.#payload = encoder.encode(text);
    this.bytes = this.#payload.byteLength + label.length * 2;
  }
  readJson(): string {
    return decoder.decode(this.#payload);
  }
  read(): T {
    return JSON.parse(this.readJson()) as T;
  }
}

export function historyBytes<T>(entries: readonly HistoryEntry<T>[]) {
  return entries.reduce((total, entry) => total + entry.bytes, 0);
}

/** Keep a contiguous, newest suffix. An unaffordable nearest entry cannot be skipped. */
function recentHistory<T>(entries: HistoryEntry<T>[], bytes: number, count: number) {
  let first = entries.length;
  while (first > 0 && entries.length - first < count && entries[first - 1].bytes <= bytes) {
    bytes -= entries[--first].bytes;
  }
  return first === 0 ? entries : entries.slice(first);
}

export function appendHistory<T>(
  stack: HistoryEntry<T>[],
  entry: HistoryEntry<T>,
  byteLimit = HISTORY_BYTE_LIMIT,
  countLimit = 30,
) {
  return recentHistory([...stack, entry], byteLimit, countLimit);
}

/** Reserve the new inverse step first, then bound the combined retained payload. */
export function moveHistory<T>(
  source: HistoryEntry<T>[],
  destination: HistoryEntry<T>[],
  inverse: HistoryEntry<T>,
  byteLimit = HISTORY_BYTE_LIMIT,
  countLimit = 30,
) {
  const nextDestination = appendHistory(destination, inverse, byteLimit, countLimit);
  const nextSource = recentHistory(source.slice(0, -1), byteLimit - historyBytes(nextDestination), countLimit);
  return { source: nextSource, destination: nextDestination };
}
