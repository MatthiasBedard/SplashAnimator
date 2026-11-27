import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/features/suggest/register';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/toggleTabFocusMode/register';
import { createSourceLanguageClient } from './source-language-client';
import { sourceSelection } from './source-selection';
import { applyCodeEditorPreferences } from './code-editor-preferences';
let serial = 0;
export function createSourceCodeEditor(
  container: HTMLElement,
  source: string,
  changed: (source: string) => void,
  status: (message: string) => void,
  compositionChanged: (composing: boolean) => void,
) {
  const model = monaco.editor.createModel(
    source,
    'typescript',
    monaco.Uri.parse(`inmemory://splash/frame-${++serial}.ts`),
  );
  const disposers = [() => model.dispose()];
  let alive = true;
  const dispose = () => {
    if (!alive) return;
    alive = false;
    while (disposers.length) disposers.pop()!();
  };
  try {
    model.setEOL(
      source.includes('\r\n')
        ? monaco.editor.EndOfLineSequence.CRLF
        : monaco.editor.EndOfLineSequence.LF,
    );
    const editor = monaco.editor.create(container, {
      model,
      editContext: false,
      theme: 'vs-dark',
      ariaLabel: 'Frame source code editor',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordBasedSuggestions: 'off',
      unusualLineTerminators: 'off',
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
      links: false,
      quickSuggestions: false,
      accessibilitySupport: 'auto',
      fixedOverflowWidgets: true,
    });
    disposers.push(() => editor.dispose());
    disposers.push(applyCodeEditorPreferences(editor, model));
    // Monaco stores a leading BOM outside the editable buffer. Keep it in saved
    // source and project raw diagnostic/cursor positions onto the visible model.
    const text = () => model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true);
    const bom = () =>
      model.getValueLength(monaco.editor.EndOfLinePreference.TextDefined, true) >
      model.getValueLength(monaco.editor.EndOfLinePreference.TextDefined, false);
    const offset = (position: monaco.IPosition) => model.getOffsetAt(position) + (bom() ? 1 : 0);
    function rangeAt(source: string, location: { line: number; column: number }) {
      const range = sourceSelection(source, location);
      if (!range) return;
      const prefix = bom() ? 1 : 0;
      return monaco.Range.fromPositions(
        model.getPositionAt(Math.max(0, range.start - prefix)),
        model.getPositionAt(Math.max(0, range.end - prefix)),
      );
    }
    const client = createSourceLanguageClient();
    let composing = false,
      visible = container.getClientRects().length > 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    disposers.push(
      () => client.dispose(),
      () => clearTimeout(timer),
    );
    const available = () => alive && visible && !composing;
    const current = (version: number) =>
      available() && !model.isDisposed() && model.getVersionId() === version;
    async function diagnostics() {
      const version = model.getVersionId();
      const source = text();
      try {
        const result = await client.request({ kind: 'diagnostics', source });
        if (!current(version) || result.kind !== 'diagnostics') return;
        monaco.editor.setModelMarkers(
          model,
          'splash-frame',
          result.diagnostics.flatMap((d) => {
            const range = rangeAt(source, d);
            return range
              ? [
                  {
                    ...range,
                    severity: monaco.MarkerSeverity.Error,
                    message: d.message,
                    code: String(d.code),
                  },
                ]
              : [];
          }),
        );
        status(
          result.diagnostics.length
            ? `${result.diagnostics.length} source diagnostic${result.diagnostics.length === 1 ? '' : 's'}.`
            : 'Code editor ready. Source was not executed.',
        );
      } catch (error) {
        if (current(version)) status(String(error));
      }
    }
    const schedule = () => {
      clearTimeout(timer);
      if (available()) timer = setTimeout(() => void diagnostics(), 300);
    };
    // Hidden docks and inactive tab panels keep the Monaco buffer and undo stack.
    const visibility = new ResizeObserver(() => {
      if (!alive) return;
      const next = container.getClientRects().length > 0;
      if (visible === next) return;
      visible = next;
      if (visible) schedule();
      else {
        clearTimeout(timer);
        client.cancel();
      }
    });
    disposers.push(() => visibility.disconnect());
    visibility.observe(container);
    const compositionStart = editor.onDidCompositionStart(() => {
      composing = true;
      clearTimeout(timer);
      client.cancel();
      compositionChanged(true);
    });
    disposers.push(() => compositionStart.dispose());
    const compositionEnd = editor.onDidCompositionEnd(() => {
      composing = false;
      compositionChanged(false);
      schedule();
    });
    disposers.push(() => compositionEnd.dispose());
    const content = editor.onDidChangeModelContent(() => {
      client.cancel();
      monaco.editor.setModelMarkers(model, 'splash-frame', []);
      changed(text());
      schedule();
    });
    disposers.push(() => content.dispose());
    const completion = monaco.languages.registerCompletionItemProvider('typescript', {
      triggerCharacters: ['.'],
      async provideCompletionItems(candidate, position, _context, token) {
        if (candidate !== model || !available()) return;
        const version = model.getVersionId(),
          word = model.getWordUntilPosition(position);
        try {
          const result = await client.request({
            kind: 'complete',
            source: text(),
            offset: offset(position),
          });
          if (!current(version) || token.isCancellationRequested || result.kind !== 'complete')
            return;
          return {
            suggestions: result.items.map((item) => ({
              label: item.label,
              insertText: item.label,
              kind:
                item.kind === 'method' || item.kind === 'function'
                  ? monaco.languages.CompletionItemKind.Method
                  : monaco.languages.CompletionItemKind.Property,
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              ),
            })),
          };
        } catch {
          return;
        }
      },
    });
    disposers.push(() => completion.dispose());
    const hover = monaco.languages.registerHoverProvider('typescript', {
      async provideHover(candidate, position, token) {
        if (candidate !== model || !available()) return;
        const version = model.getVersionId();
        try {
          const result = await client.request({
            kind: 'hover',
            source: text(),
            offset: offset(position),
          });
          if (
            !current(version) ||
            token.isCancellationRequested ||
            result.kind !== 'hover' ||
            !result.text
          )
            return;
          return {
            contents: [
              {
                value: '```typescript\n' + result.text.replace(/```/g, '` ` `') + '\n```',
                isTrusted: false,
                supportHtml: false,
              },
            ],
          };
        } catch {
          return;
        }
      },
    });
    disposers.push(() => hover.dispose());
    schedule();
    return Object.freeze({
      locate(location: { line: number; column: number }) {
        if (!available()) return;
        const range = rangeAt(text(), location);
        if (!range) return;
        editor.setSelection(range);
        editor.revealRangeInCenter(range);
        editor.focus();
      },
      focus() {
        if (alive) editor.focus();
      },
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
