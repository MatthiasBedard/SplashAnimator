import { tools, type Tool } from '../../../packages/interaction/src';

const commands = [
  ['open', 'Open project', 'Primary+o'],
  ['save', 'Save', 'Primary+s'],
  ['saveAs', 'Save as', 'Primary+Shift+s'],
  ['undo', 'Undo', 'Primary+z'],
  ['redo', 'Redo', 'Primary+Shift+z'],
  ['all', 'Select all artwork', 'Primary+a'],
  ['duplicate', 'Duplicate artwork', 'Primary+d'],
  ['pasteInPlace', 'Paste in place', 'Primary+Shift+v'],
  ['group', 'Group artwork', 'Primary+g'],
  ['ungroup', 'Ungroup artwork', 'Primary+Shift+g'],
  ['free', 'Free transform', 'q'],
  ['frame', 'Insert frame', 'f5'],
  ['removeFrames', 'Delete frames', 'Shift+f5'],
  ['keyframe', 'Insert keyframe', 'f6'],
  ['removeKeys', 'Clear keyframes', 'Shift+f6'],
  ['blank', 'Insert blank keyframe', 'f7'],
  ['symbol', 'Convert to symbol', 'f8'],
  ['script', 'Open Script Editor', 'f9'],
  ['play', 'Play or stop timeline', 'enter'],
  ['testMovie', 'Test Movie', 'Primary+enter'],
] as const;

export type ShortcutAction = (typeof commands)[number][0] | `tool:${Tool}`;
export type ShortcutOverrides = Partial<Record<ShortcutAction, string | null>>;
type Shortcut = { id: ShortcutAction; label: string; binding: string | null };
export const EDITOR_SHORTCUTS: readonly Shortcut[] = [
  ...commands.map(([id, label, binding]) => ({ id, label, binding })),
  ...tools.map(({ id, label, key }): Shortcut => ({
    id: toolShortcut(id),
    label: label + ' tool',
    binding: key.toLowerCase() || null,
  })),
];
const definitions = new Map(EDITOR_SHORTCUTS.map(shortcut => [shortcut.id, shortcut]));
const alternateRedoBinding = 'Primary+y';
export const SHORTCUTS_KEY = 'splash-shortcuts-v1';

export function toolShortcut(tool: Tool): ShortcutAction {
  return `tool:${tool}`;
}

export function bindingFor(overrides: ShortcutOverrides, id: ShortcutAction): string | null {
  return overrides[id] === undefined ? (definitions.get(id)?.binding ?? null) : overrides[id];
}

const platformKeys = new Set([
  'Primary+c', 'Primary+x', 'Primary+v', 'Primary+f', 'Primary+h', 'Primary+j',
  'Primary+k', 'Primary+l', 'Primary+n', 'Primary+p', 'Primary+r', 'Primary+t',
  'Primary+u', 'Primary+w', 'Primary+q', 'Primary+m', alternateRedoBinding, 'Primary+Shift+w',
  'Primary+Shift+t', 'Primary+Shift+n', 'Primary+Shift+r', 'Primary+Shift+i',
  'Primary+Shift+j', 'Primary+Shift+c', 'f10', 'Shift+f10',
]);
const syntax = /^(?:Primary\+)?(?:Shift\+)?(?:[\p{L}\p{N}]|f[5-9]|f10|enter)$/u;

function allowed(binding: string, id: ShortcutAction) {
  if (!syntax.test(binding) || binding !== binding.toLowerCase().replace(/^primary\+/, 'Primary+').replace(/^(Primary\+)?shift\+/, '$1Shift+')) return false;
  if (platformKeys.has(binding)) return false;
  if (binding.endsWith('enter')) return binding === definitions.get(id)?.binding;
  return true;
}

type KeyInput = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'getModifierState'>;
export function bindingFromKey(event: KeyInput): string | undefined {
  if (event.isComposing || event.altKey || event.getModifierState('AltGraph') ||
      (event.ctrlKey && event.metaKey)) return;
  const value = [event.ctrlKey || event.metaKey ? 'Primary+' : '', event.shiftKey ? 'Shift+' : '',
    event.key.normalize('NFC').toLowerCase()].join('');
  if (syntax.test(value)) return value;
}

export function shortcutForKey(event: KeyInput, overrides: ShortcutOverrides) {
  const binding = bindingFromKey(event);
  if (binding === alternateRedoBinding && overrides.redo === undefined) return 'redo';
  return binding && EDITOR_SHORTCUTS.find(({ id }) => bindingFor(overrides, id) === binding)?.id || undefined;
}

export function shortcutText(binding: string | null, mac: boolean): string {
  if (!binding) return '';
  return binding.split('+').map(part => {
    if (part === 'Primary') return mac ? '⌘' : 'Ctrl';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    return part === 'enter' ? 'Enter' : part.toUpperCase();
  }).join(mac ? '' : ' ');
}

export function shortcutDisplay(overrides: ShortcutOverrides, id: ShortcutAction, mac: boolean) {
  const label = shortcutText(bindingFor(overrides, id), mac);
  return id === 'redo' && overrides.redo === undefined
    ? `${label} / ${shortcutText(alternateRedoBinding, mac)}`
    : label;
}

function validateShortcuts(input: unknown): ShortcutOverrides {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid shortcut map.');
  const overrides: ShortcutOverrides = {};
  for (const [action, binding] of Object.entries(input)) {
    const id = action as ShortcutAction;
    if (!definitions.has(id)) throw Error('Unknown shortcut action.');
    if (binding !== null && (typeof binding !== 'string' || !allowed(binding, id)))
      throw Error('That key is reserved or cannot be assigned.');
    if (binding !== definitions.get(id)?.binding) overrides[id] = binding;
  }
  const used = new Map<string, string>();
  for (const { id, label } of EDITOR_SHORTCUTS) {
    const binding = bindingFor(overrides, id);
    if (!binding) continue;
    const existing = used.get(binding);
    if (existing) throw Error(`${label} conflicts with ${existing}.`);
    used.set(binding, label);
  }
  return overrides;
}

export function changeShortcut(overrides: ShortcutOverrides, id: ShortcutAction, binding: string | null) {
  return validateShortcuts({ ...overrides, [id]: binding });
}

export function exportShortcuts(bindings: ShortcutOverrides) {
  return JSON.stringify({ version: 1, bindings }, null, 2);
}

export function importShortcuts(text: string): ShortcutOverrides {
  if (text.length > 64 * 1024) throw Error('Shortcut file is too large.');
  const input: unknown = JSON.parse(text);
  if (!input || typeof input !== 'object' || !('version' in input) ||
      input.version !== 1 || !('bindings' in input)) throw Error('Invalid shortcut file.');
  return validateShortcuts(input.bindings);
}

export function loadShortcuts(): ShortcutOverrides {
  try { return importShortcuts(localStorage.getItem(SHORTCUTS_KEY) ?? ''); }
  catch { return {}; }
}
