import type { Project } from '../../../packages/document/src';
import { timelineScrollStep } from '../../../packages/animation/src/timeline';
import type { EditorTimelineDrag } from './editor-state-types';

type Row = { id: string; folderRowId?: string | null };
type FrameMapping = { sourceId: string; targetId: string };
type View = {
  project: Project;
  revision: number;
  layer: string;
  rows: readonly Row[];
  visible: readonly Row[];
  rowCount: number;
  frameStart: number;
  layerStart: number;
  cellWidth: number;
  frameLimit: number;
};
type Block<Prior> = { anchor: number; row: string; origin: number; originRow: string; prior: Prior; priorFrame: number };
type BlockSelection =
  | { kind: 'future'; row: string; at: number; frame: number }
  | { kind: 'range'; layers: string[]; anchor: number; start: number; end: number; at: number; frame: number };
type Surface = Pick<HTMLCanvasElement, 'getBoundingClientRect' | 'setPointerCapture' |
  'hasPointerCapture' | 'releasePointerCapture'>;
type Sample = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>;
type Host<Prior> = {
  surface: () => Surface;
  read: () => View;
  beginSelection: (row: string) => void;
  select: (selection: BlockSelection) => void;
  restore: (prior: Prior) => void;
  preview: (move: EditorTimelineDrag | null) => void;
  scroll: (frame: number, layer: number) => void;
  drop: (move: EditorTimelineDrag, mappings: FrameMapping[]) => void;
};
type Intent<Prior> =
  | { kind: 'select'; block: Block<Prior> }
  | { kind: 'move'; move: EditorTimelineDrag };
type Session<Prior> = {
  intent: Intent<Prior>;
  surface: Surface;
  project: Project;
  revision: number;
  pointer: number;
  x: number;
  y: number;
  time: number;
};

export function timelineBlockMappings(drag: EditorTimelineDrag, rows: readonly Row[]): FrameMapping[] {
  const artwork = rows.filter(row => !row.folderRowId);
  const hit = artwork.findIndex(row => row.id === drag.target);
  const start = hit - (drag.originRow ?? 0);
  if (hit < 0 || start < 0 || start + drag.layers.length > artwork.length) return [];
  return drag.layers.map((sourceId, index) => ({ sourceId, targetId: artwork[start + index].id }));
}

function selectBlock<Prior>(block: Block<Prior>, view: View, rect: DOMRect, x: number, y: number): BlockSelection | undefined {
  const row = Math.max(0, Math.min(view.visible.length - 1, Math.floor((y - rect.top - 25) / 28)));
  const hit = view.visible[row];
  if (!hit || hit.folderRowId) return;
  const first = view.rows.findIndex(item => item.id === block.row);
  const last = view.rows.findIndex(item => item.id === hit.id);
  if (first < 0 || last < 0) return;
  const at = Math.max(0, Math.min(view.frameLimit - 1, view.frameStart + Math.floor((x - rect.left) / view.cellWidth)));
  const lastFrame = view.project.duration - 1;
  if (block.origin > lastFrame && block.anchor === block.origin && at === block.origin && hit.id === block.originRow)
    return { kind: 'future', row: hit.id, at, frame: block.priorFrame };
  const start = Math.min(block.anchor, at), end = Math.max(block.anchor, at);
  const layers = view.rows.slice(Math.min(first, last), Math.max(first, last) + 1)
    .filter(item => !item.folderRowId).map(item => item.id);
  return { kind: 'range', layers, start, end, at, anchor: Math.min(block.anchor, lastFrame),
    frame: start > lastFrame ? block.priorFrame : Math.min(lastFrame, at) };
}

function movePosition(drag: EditorTimelineDrag, view: View, rect: DOMRect, x: number, y: number, horizontal: boolean, clampX: boolean) {
  if (drag.cross) {
    const row = view.visible[Math.floor((y - rect.top - 25) / 28)];
    drag.target = row && !row.folderRowId ? row.id : null;
  }
  if (horizontal) {
    const at = x - rect.left;
    const cell = view.frameStart + Math.floor((clampX ? Math.max(0, Math.min(rect.width - 1, at)) : at) / view.cellWidth);
    drag.at = Math.max(0, Math.min(100000 - (drag.end - drag.start + 1), drag.start + cell - drag.origin));
  }
}

export function createTimelineEditGesture<Prior>(host: Host<Prior>) {
  let active: Session<Prior> | undefined;

  function owns(session: Session<Prior>, view: View) {
    return view.project === session.project && view.revision === session.revision &&
      (session.intent.kind === 'select' || view.layer === session.intent.move.layer);
  }

  function cancel(pointer = active?.pointer, restore = true) {
    const session = active;
    if (!session || pointer !== session.pointer) return;
    active = undefined;
    if (session.intent.kind === 'move') host.preview(null);
    else if (restore && owns(session, host.read())) host.restore(session.intent.block.prior);
    if (session.surface.hasPointerCapture(pointer)) session.surface.releasePointerCapture(pointer);
  }

  function current(session: Session<Prior>) {
    const view = host.read();
    if (active !== session) return;
    if (!owns(session, view)) { cancel(session.pointer, false); return; }
    return view;
  }

  function update(session: Session<Prior>, horizontal = true, clampX = false) {
    const rect = session.surface.getBoundingClientRect();
    const view = current(session);
    if (!view) return;
    if (session.intent.kind === 'select') {
      const selection = selectBlock(session.intent.block, view, rect, session.x, session.y);
      if (selection) host.select(selection);
    } else {
      const drag = session.intent.move;
      movePosition(drag, view, rect, session.x, session.y, horizontal, clampX);
      host.preview({ ...drag });
    }
  }

  function start(intent: Intent<Prior>, sample: Sample, time: number) {
    if (active || !Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY)) return;
    const view = host.read();
    if (intent.kind === 'move') {
      const drag = intent.move;
      if (drag.projectId !== view.project.id || drag.revision !== view.revision ||
          drag.layer !== view.layer || drag.pointer !== sample.pointerId) return;
      intent = { kind: 'move', move: { ...drag, layers: [...drag.layers] } };
    }
    const session = { intent, surface: host.surface(), project: view.project, revision: view.revision,
      pointer: sample.pointerId, x: sample.clientX, y: sample.clientY, time };
    active = session;
    try { session.surface.setPointerCapture(session.pointer); }
    catch { cancel(session.pointer, false); return; }
    if (!current(session)) return;
    if (intent.kind === 'select') {
      host.beginSelection(intent.block.row);
      update(session);
    } else host.preview({ ...intent.move });
  }

  function move(sample: Sample) {
    const session = active;
    if (!session) return false;
    if (session.pointer === sample.pointerId &&
        Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY) && current(session)) {
      session.x = sample.clientX;
      session.y = sample.clientY;
      update(session);
    }
    return true;
  }

  function finish(sample: Sample) {
    const session = active;
    if (!session) return false;
    if (sample.pointerId !== session.pointer) return true;
    if (!Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY)) {
      cancel(session.pointer);
      return true;
    }
    move(sample);
    if (active !== session) return true;
    cancel(session.pointer, false);
    const view = host.read();
    if (active || !owns(session, view) || session.intent.kind === 'select') return true;
    const drag = session.intent.move;
    const mappings = drag.block ? timelineBlockMappings(drag, view.rows)
      : drag.cross && drag.target !== drag.layer
        ? drag.target ? [{ sourceId: drag.layer, targetId: drag.target }] : []
        : drag.layers.map(sourceId => ({ sourceId, targetId: sourceId }));
    if (mappings.length && (drag.at !== drag.start || mappings.some(item => item.sourceId !== item.targetId)))
      host.drop(drag, mappings);
    return true;
  }

  function tick(time: number) {
    const session = active;
    if (!session) return false;
    if (time - session.time < 80 || !current(session)) return true;
    const rect = session.surface.getBoundingClientRect();
    const view = current(session);
    if (!view) return true;
    session.time = time;
    const frame = timelineScrollStep(view.frameStart, session.x - rect.left, rect.width, view.project.duration, view.cellWidth);
    const y = session.y - rect.top;
    const bottom = session.intent.kind === 'select' ? rect.height : 25 + view.rowCount * 28;
    const direction = y < 39 ? -1 : y > bottom - 14 ? 1 : 0;
    const canScrollRows = session.intent.kind === 'select' || session.intent.move.cross;
    const layer = canScrollRows && direction
      ? Math.max(0, Math.min(Math.max(0, view.rows.length - view.rowCount), view.layerStart + direction))
      : view.layerStart;
    const changedFrame = frame !== view.frameStart;
    if (changedFrame || layer !== view.layerStart) host.scroll(frame, layer);
    if (canScrollRows || changedFrame) update(session, changedFrame, true);
    return true;
  }

  return { get active() { return !!active; }, start, move, finish, tick, cancel };
}
