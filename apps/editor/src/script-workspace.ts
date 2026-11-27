export type ScriptTab = { path: string; original: string | null; text: string };
export type FrameScriptFile = { path: string; symbolName?: string };
export const frameScriptStarter = '// Code goes here.\n';
export function isScriptSaveShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
    !event.getModifierState('AltGraph') && event.key.toLowerCase() === 's';
}
export function frameScriptPath(frame: number, symbolId?: string) {
  const folder = symbolId === undefined ? 'Frames' : 'Frames/' + encodeURIComponent(JSON.stringify(symbolId));
  return folder + '/Frame ' + (frame + 1);
}
export type ScriptWorkspace = {
  active: string;
  tabs: ScriptTab[];
  explorer: { visible: boolean; width: number; collapsed: string[]; search: string };
};
export const defaultScriptExplorerWidth = 248;
export const emptyWorkspace = (): ScriptWorkspace => ({
  active: '',
  tabs: [],
  explorer: { visible: true, width: defaultScriptExplorerWidth, collapsed: [], search: '' },
});
export type FileCommand =
  | { op: 'list' }
  | { op: 'read'; path: string }
  | { op: 'remove'; path: string; expected: string | null }
  | { op: 'save'; path: string; expected: string | null; text: string };
export type FileOperation = (command: FileCommand) => Promise<string[] | string | null>;
