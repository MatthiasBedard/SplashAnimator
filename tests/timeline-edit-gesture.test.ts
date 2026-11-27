import { expect, test, vi } from 'vitest';
import { createTimelineEditGesture, timelineBlockMappings } from '../apps/editor/src/timeline-edit-gesture';
import type { EditorTimelineDrag } from '../apps/editor/src/editor-state-types';
import { newProject } from '../packages/document/src';

function setup() {
  let capture: number | undefined;
  const surface = {
    getBoundingClientRect: () => ({ left: 100, top: 200, width: 200, height: 137 }) as DOMRect,
    setPointerCapture: vi.fn((id: number) => { capture = id; }),
    hasPointerCapture: (id: number) => capture === id,
    releasePointerCapture: vi.fn(() => { capture = undefined; }),
  };
  const rows = [{ id: 'a' }, { id: 'folder', folderRowId: 'folder' }, { id: 'b' }, { id: 'c' }];
  const view = { project: newProject(), revision: 1, layer: 'a', rows, visible: rows, rowCount: 4,
    frameStart: 0, layerStart: 0, cellWidth: 18, frameLimit: 100000 };
  const restore = vi.fn(), select = vi.fn(), preview = vi.fn();
  const drop = vi.fn(() => { expect(capture).toBeUndefined(); });
  const beginSelection = vi.fn();
  const scroll = vi.fn((frame: number, layer: number) => { view.frameStart = frame; view.layerStart = layer; });
  const edit = createTimelineEditGesture<string>({
    surface: () => surface, read: () => view, beginSelection, select, restore, preview, scroll, drop,
  });
  const point = (clientX: number, clientY: number, pointerId = 1) => ({ pointerId, clientX, clientY });
  const drag: EditorTimelineDrag = { pointer: 1, block: true, layers: ['a', 'b'], originRow: 0,
    cross: true, target: 'a', projectId: view.project.id, layer: 'a', revision: view.revision,
    start: 2, end: 5, origin: 3, at: 2 };
  return { edit, point, view, surface, select, restore, drop, preview, beginSelection, scroll, drag };
}

test('frame block selection preserves prior state on cancellation while foreign pointers are ignored', () => {
  const f = setup();
  f.edit.start({ kind: 'select', block: {
    anchor: 2, origin: 2, row: 'a', originRow: 'a', priorFrame: 1, prior: 'prior',
  } }, f.point(145, 238), 0);
  expect(f.select).toHaveBeenLastCalledWith(expect.objectContaining({ layers: ['a'], at: 2 }));
  f.edit.move(f.point(199, 294, 9));
  expect(f.select).toHaveBeenCalledOnce();
  f.edit.move(f.point(199, 294));
  expect(f.select).toHaveBeenLastCalledWith(expect.objectContaining({ layers: ['a', 'b'], at: 5 }));
  f.edit.cancel(9);
  expect(f.edit.active).toBe(true);
  f.edit.cancel(1);
  expect(f.restore).toHaveBeenCalledExactlyOnceWith('prior');
  expect(f.surface.releasePointerCapture).toHaveBeenCalledWith(1);
});

test('frame movement maps artwork rows after capture is cleared and drops once', () => {
  const f = setup();
  f.edit.start({ kind: 'move', move: f.drag }, f.point(163, 238), 0);
  f.edit.finish(f.point(271, 294));
  expect(f.preview).toHaveBeenLastCalledWith(null);
  expect(f.drop).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ at: 8 }), [
    { sourceId: 'a', targetId: 'b' }, { sourceId: 'b', targetId: 'c' },
  ]);
  expect(f.edit.finish(f.point(271, 294))).toBe(false);
  expect(timelineBlockMappings({ ...f.drag, target: 'folder' }, f.view.rows)).toEqual([]);
});

test('failed capture permits retry and stale revision cancels before scrolling or dropping', () => {
  const f = setup();
  f.surface.setPointerCapture.mockImplementationOnce(() => { throw Error('capture denied'); });
  f.edit.start({ kind: 'move', move: f.drag }, f.point(163, 238), 0);
  expect(f.edit.active).toBe(false);
  expect(f.preview).not.toHaveBeenCalledWith(expect.anything());
  f.edit.start({ kind: 'move', move: f.drag }, f.point(163, 238), 1);
  f.edit.move(f.point(320, 294));
  f.view.revision++;
  f.edit.tick(101);
  expect(f.scroll).not.toHaveBeenCalled();
  expect(f.edit.finish(f.point(271, 294))).toBe(false);
  expect(f.drop).not.toHaveBeenCalled();
  expect(f.surface.releasePointerCapture).toHaveBeenCalledWith(1);
});
