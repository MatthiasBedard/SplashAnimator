import type { editor } from 'monaco-editor/editor/editor.api';

export const CODE_EDITOR_PREFERENCES_KEY = 'splash-code-editor-preferences-v1';

const defaults = {
  indentation: 'spaces' as 'spaces' | 'tabs',
  indentSize: 2,
  detectIndentation: false,
  fontSize: 13,
  wordWrap: false,
  lineNumbers: true,
};
export type CodeEditorPreferences = Readonly<typeof defaults>;

function normalize(data: Partial<CodeEditorPreferences> | null): CodeEditorPreferences {
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? value : fallback;
  return {
    indentation: data?.indentation === 'tabs' ? 'tabs' : 'spaces',
    indentSize: number(data?.indentSize, 1, 16, defaults.indentSize),
    detectIndentation: data?.detectIndentation === true,
    fontSize: number(data?.fontSize, 10, 32, defaults.fontSize),
    wordWrap: data?.wordWrap === true,
    lineNumbers: data?.lineNumbers !== false,
  };
}

function read(value: string | null) {
  try { return normalize(JSON.parse(value ?? 'null')); }
  catch { return defaults; }
}

let current: CodeEditorPreferences = defaults;
try { current = read(localStorage.getItem(CODE_EDITOR_PREFERENCES_KEY)); }
catch { /* Preferences still apply to the current window. */ }

const listeners = new Set<(value: CodeEditorPreferences) => void>();
function publish(value: CodeEditorPreferences) {
  current = value;
  for (const listener of listeners) listener(value);
}

window.addEventListener('storage', event => {
  if (event.storageArea === localStorage &&
      (event.key === CODE_EDITOR_PREFERENCES_KEY || event.key === null)) {
    publish(read(event.newValue));
  }
});

export function updateCodeEditorPreferences(changes: Partial<CodeEditorPreferences>) {
  const next = normalize({ ...current, ...changes });
  try { localStorage.setItem(CODE_EDITOR_PREFERENCES_KEY, JSON.stringify(next)); }
  catch { /* Preferences still apply to the current window. */ }
  publish(next);
}

export function observeCodeEditorPreferences(listener: (value: CodeEditorPreferences) => void) {
  listener(current);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyCodeEditorPreferences(view: editor.IStandaloneCodeEditor, model: editor.ITextModel) {
  let previous: CodeEditorPreferences | undefined;
  return observeCodeEditorPreferences(value => {
    if (previous?.indentation !== value.indentation || previous.indentSize !== value.indentSize ||
        previous.detectIndentation !== value.detectIndentation) {
      const insertSpaces = value.indentation === 'spaces';
      if (value.detectIndentation) model.detectIndentation(insertSpaces, value.indentSize);
      else model.updateOptions({ insertSpaces, tabSize: value.indentSize, indentSize: value.indentSize });
    }
    view.updateOptions({
      fontSize: value.fontSize,
      wordWrap: value.wordWrap ? 'on' : 'off',
      lineNumbers: value.lineNumbers ? 'on' : 'off',
    });
    previous = value;
  });
}
