import { describe, expect, it } from 'vitest';
import {
  activatePanel,
  defaultPanelLayout,
  readPanelLayout,
  separatePanel,
  tabPanelWith,
  togglePanel,
  visiblePanelGroups,
} from '../apps/editor/src/panel-layout';

describe('workspace panel preferences', () => {
  it('coalesces old symbol/bitmap tabs and preferences into one Library without losing other panels', () => {
    const layout = readPanelLayout(
      JSON.stringify({
        version: 1,
        sidebarVisible: true,
        hidden: ['bitmaps'],
        collapsed: ['symbols', 'bitmaps'],
        groups: [{ id: 'g1', panels: ['symbols', 'bitmaps', 'paint'], active: 'bitmaps' }],
      }),
    );
    expect(layout.hidden).toEqual([]);
    expect(layout.collapsed).toEqual(['library']);
    expect(layout.groups).toEqual([{ id: 'g1', panels: ['library', 'paint'], active: 'library' }]);
    expect(readPanelLayout(JSON.stringify(layout))).toEqual(layout);
  });
  it('starts expanded and visible without project state', () => {
    expect(defaultPanelLayout()).toEqual({
      version: 1,
      sidebarVisible: true,
      hidden: [],
      collapsed: [],
      groups: [],
    });
  });
  it('groups panels, selects the moved panel and preserves independent hidden/collapse choices', () => {
    let p = togglePanel(defaultPanelLayout(), 'paint', 'hidden');
    p = togglePanel(p, 'layer', 'collapsed');
    p = tabPanelWith(p, 'paint', 'layer');
    expect(p.groups).toEqual([{ id: 'g1', panels: ['layer', 'paint'], active: 'paint' }]);
    expect(p.hidden).toEqual([]);
    expect(p.collapsed).toEqual(['layer']);
    expect(activatePanel(p, 'layer').collapsed).toEqual([]);
  });
  it('moves only the chosen tab between groups and dissolves singletons', () => {
    let p = tabPanelWith(defaultPanelLayout(), 'paint', 'layer');
    p = tabPanelWith(p, 'library', 'defaults');
    p = tabPanelWith(p, 'paint', 'library');
    expect(p.groups).toEqual([
      { id: 'g2', panels: ['defaults', 'library', 'paint'], active: 'paint' },
    ]);
    expect(
      visiblePanelGroups(p, ['layer', 'library', 'defaults', 'paint']).map((g) => g.panels),
    ).toEqual([['defaults', 'library', 'paint'], ['layer']]);
    p = separatePanel(p, 'library');
    expect(p.groups[0].panels).toEqual(['defaults', 'paint']);
    p = separatePanel(p, 'paint');
    expect(p.groups).toEqual([]);
  });
  it('keeps group ids unique when the original target is moved elsewhere', () => {
    let p = tabPanelWith(defaultPanelLayout(), 'paint', 'layer');
    p = tabPanelWith(p, 'library', 'paint');
    p = tabPanelWith(p, 'layer', 'document');
    expect(new Set(p.groups.map((g) => g.id)).size).toBe(2);
    expect(readPanelLayout(JSON.stringify(p))).toEqual(p);
  });
  it('falls back to an available visible tab without losing the preferred tab', () => {
    const p = tabPanelWith(defaultPanelLayout(), 'pencil', 'brush');
    expect(visiblePanelGroups(p, ['brush'])[0].active).toBe('brush');
    expect(p.groups[0].active).toBe('pencil');
    expect(
      visiblePanelGroups(togglePanel(p, 'pencil', 'hidden'), ['pencil', 'brush'])[0].active,
    ).toBe('brush');
    expect(visiblePanelGroups(p, ['pencil', 'brush'])[0].active).toBe('pencil');
  });
  it('round trips workspace preferences exactly and detached', () => {
    const p = togglePanel(
      tabPanelWith(defaultPanelLayout(), 'library', 'layer'),
      'document',
      'collapsed',
    );
    const restored = readPanelLayout(JSON.stringify(p));
    expect(restored).toEqual(p);
    restored.groups[0].panels.push('paint');
    expect(p.groups[0].panels).not.toContain('paint');
  });
  for (const raw of [
    null,
    'bad',
    'null',
    '{}',
    JSON.stringify({ ...defaultPanelLayout(), version: 2 }),
    JSON.stringify({ ...defaultPanelLayout(), hidden: ['unknown'] }),
    JSON.stringify({ ...defaultPanelLayout(), collapsed: ['layer', 'layer'] }),
    JSON.stringify({
      ...defaultPanelLayout(),
      groups: [{ id: 'g1', panels: ['layer', 'paint'], active: 'library' }],
    }),
    JSON.stringify({
      ...defaultPanelLayout(),
      groups: [
        { id: 'g1', panels: ['layer', 'paint'], active: 'paint' },
        { id: 'g2', panels: ['library', 'paint'], active: 'paint' },
      ],
    }),
  ])
    it(`recovers malformed storage ${raw}`, () =>
      expect(readPanelLayout(raw)).toEqual(defaultPanelLayout()));
});
