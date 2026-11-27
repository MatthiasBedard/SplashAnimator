import { expect, it } from 'vitest';
import { workspaceSizing, DEFAULT_WORKSPACE_SIZES } from '../apps/editor/src/workspace-sizes';
import { defaultPanelLayout, readPanelLayout } from '../apps/editor/src/panel-layout';
it('keeps the existing default panel dimensions and six timeline rows', () => {
  const s = workspaceSizing(undefined, 1440, 800);
  expect([s.tools, s.inspector, s.timeline]).toEqual([84, 262, 267]);
  expect(s.timelineContent).toBe(193);
  expect(s.timelineRows).toBe(6);
  expect(defaultPanelLayout().sizes).toBeUndefined();
});
it('clamps display sizes while preserving the stored request and room for the stage', () => {
  const saved = { tools: 200, inspector: 640, timeline: 800 },
    before = { ...saved };
  const narrow = workspaceSizing(saved, 960, 700);
  expect(narrow.tools + narrow.inspector).toBeLessThanOrEqual(640);
  expect(narrow.timeline).toBe(460);
  expect(saved).toEqual(before);
  const wide = workspaceSizing(saved, 1920, 1200);
  expect(wide.inspector).toBe(640);
  expect(wide.timeline).toBe(800);
});
it('hiding the sidebar releases its width budget without losing its requested size', () => {
  const shown = workspaceSizing({ inspector: 640 }, 960, 800, true);
  const hidden = workspaceSizing({ inspector: 640 }, 960, 800, false);
  expect(hidden.toolsMax).toBeGreaterThanOrEqual(shown.toolsMax);
  expect(hidden.inspector).toBe(shown.inspector);
});
it('keeps room for the stage and docked sidebar in compact windows', () => {
  for (const width of [320, 360, 512, 639]) {
    const saved = { tools: 84, inspector: 420 };
    const sizes = workspaceSizing(saved, width, 420);
    expect(width - sizes.tools - sizes.inspector).toBeGreaterThanOrEqual(Math.floor(width * 0.45));
    expect(sizes.inspector).toBeGreaterThanOrEqual(sizes.inspectorMin);
    expect(sizes.inspector).toBeLessThanOrEqual(sizes.inspectorMax);
    expect(workspaceSizing(saved, 1440, 800).inspector).toBe(420);
  }
});
it('resizes timeline rows from the actual available body height', () => {
  expect(workspaceSizing({ timeline: 130 }, 1440, 800).timelineRows).toBe(1);
  expect(workspaceSizing({ timeline: 435 }, 1440, 800).timelineRows).toBe(12);
});
it('keeps narrow panels and a one-row timeline usable at the minimum sizes', () => {
  const s = workspaceSizing({ tools: 1, inspector: 1, timeline: 1 }, 960, 700);
  expect([s.tools, s.inspector, s.timeline, s.timelineRows]).toEqual([64, 220, 130, 1]);
});
it('roundtrips only optional workspace dimensions and resets without document data', () => {
  const layout = { ...defaultPanelLayout(), sizes: { tools: 160, inspector: 420, timeline: 350 } };
  expect(readPanelLayout(JSON.stringify(layout))).toEqual(layout);
  expect(DEFAULT_WORKSPACE_SIZES).toEqual({ tools: 84, inspector: 262, timeline: 267 });
});
for (const sizes of [{ tools: null }, { inspector: -1 }, { timeline: '300' }, { other: 100 }, []])
  it('rejects malformed stored sizes safely', () => {
    expect(readPanelLayout(JSON.stringify({ ...defaultPanelLayout(), sizes }))).toEqual(
      defaultPanelLayout(),
    );
  });
it('rejects nonfinite live geometry instead of emitting invalid CSS', () => {
  expect(() => workspaceSizing({ tools: NaN }, 1440, 800)).toThrow();
  expect(() => workspaceSizing({}, Infinity, 800)).toThrow();
});
