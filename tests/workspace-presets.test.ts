import { expect, test } from 'vitest';
import { defaultPanelLayout } from '../apps/editor/src/panel-layout';
import { addWorkspace, builtinWorkspace, readSavedWorkspaces } from '../apps/editor/src/workspace-presets';

test('workspace presets retain complete detached preferences', () => {
  expect(builtinWorkspace('Standard')).toEqual(defaultPanelLayout());
  const layout = builtinWorkspace('Animation');
  layout.sidebarDock = 'left';
  layout.collapsed.push('defaults');
  const saved = addWorkspace([], '  Drawing  ', layout);
  expect(readSavedWorkspaces(JSON.stringify(saved))).toEqual(saved);
  layout.collapsed.length = 0;
  expect(saved[0].layout.collapsed).toEqual(['defaults']);
  expect(() => addWorkspace(saved, 'DRAWING', layout)).toThrow('already saved');
  expect(() => addWorkspace(saved, 'animation', layout)).toThrow('built-in');
});

test('invalid saved entries leave other workspace preferences available', () => {
  const layout = defaultPanelLayout();
  const entries = [
    { name: 'Damaged', layout: { ...layout, sidebarDock: 'bottom' } },
    { name: 'Legacy', layout },
    { name: 'legacy', layout },
    { name: 'Moved', layout: { ...layout, sidebarDock: 'left' } },
    { name: 'Missing layout' },
  ];
  expect(readSavedWorkspaces(JSON.stringify(entries))).toEqual([entries[1], entries[3]]);
  expect(readSavedWorkspaces('{')).toEqual([]);
});
