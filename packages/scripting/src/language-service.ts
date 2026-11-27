import ts from 'typescript';
import { frameTypes } from './frame-types';
import { compileFrameSource, type FrameDiagnostic } from './compile';
export type FrameLanguageRequest = {
  kind: 'complete' | 'hover' | 'diagnostics';
  source: string;
  offset?: number;
};
export type FrameLanguageReply =
  | { kind: 'complete'; items: { label: string; kind: string }[] }
  | { kind: 'hover'; text: string }
  | { kind: 'diagnostics'; diagnostics: FrameDiagnostic[] };
const prefix =
  'function __splashFrame(timeline: SplashTimeline, state: SplashState, input: SplashInput) {\n';
/** Closed virtual language service. No filesystem/module resolution or source evaluation. */
export function createFrameLanguageService(standardLibrary: string) {
  let source = '',
    version = 0,
    disposed = false;
  const files = new Map<string, ts.IScriptSnapshot>([
    ['lib.d.ts', ts.ScriptSnapshot.fromString(standardLibrary)],
    ['api.d.ts', ts.ScriptSnapshot.fromString(frameTypes)],
  ]);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      noLib: true,
      noResolve: true,
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
    }),
    getScriptFileNames: () => ['frame.ts', 'lib.d.ts', 'api.d.ts'],
    getScriptVersion: (name) => (name === 'frame.ts' ? String(version) : '0'),
    getScriptSnapshot: (name) => files.get(name),
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => 'lib.d.ts',
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name)?.getText(0, files.get(name)!.getLength()),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const service = ts.createLanguageService(host);
  return Object.freeze({
    request(input: FrameLanguageRequest): FrameLanguageReply {
      if (disposed) throw new Error('Source language service is closed.');
      const { kind, source: next, offset } = input;
      if (
        !['complete', 'hover', 'diagnostics'].includes(kind) ||
        typeof next !== 'string' ||
        next.length > 256 * 1024 ||
        new TextEncoder().encode(next).byteLength > 256 * 1024
      )
        throw new Error('Invalid source language request.');
      if (
        offset !== undefined &&
        (!Number.isSafeInteger(offset) || offset < 0 || offset > next.length)
      )
        throw new Error('Invalid source language position.');
      if (kind === 'diagnostics')
        return { kind, diagnostics: compileFrameSource(next, standardLibrary).diagnostics };
      if (!Number.isSafeInteger(offset) || offset! < 0 || offset! > next.length)
        throw new Error('Invalid source language position.');
      if (next !== source || !files.has('frame.ts')) {
        source = next;
        version++;
        files.set('frame.ts', ts.ScriptSnapshot.fromString(prefix + source + '\n}\n'));
      }
      const position = prefix.length + offset!;
      if (kind === 'complete') {
        const result = service.getCompletionsAtPosition('frame.ts', position, {
          includeCompletionsForModuleExports: false,
          includeCompletionsWithInsertText: false,
        });
        const entries = (result?.entries ?? []).filter(
          (entry) => entry.name.length <= 128 && entry.name !== '__splashFrame',
        );
        const word =
          source
            .slice(0, offset!)
            .match(/[$\p{ID_Continue}]+$/u)?.[0]
            .toLowerCase() ?? '';
        const preferred = word
          ? entries.filter((entry) => entry.name.toLowerCase().startsWith(word))
          : entries;
        const priority = new Set(preferred);
        return {
          kind,
          items: [...preferred, ...entries.filter((entry) => !priority.has(entry))]
            .slice(0, 100)
            .map((entry) => ({ label: entry.name, kind: entry.kind })),
        };
      }
      const info = service.getQuickInfoAtPosition('frame.ts', position);
      return { kind, text: ts.displayPartsToString(info?.displayParts).slice(0, 2000) };
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        source = '';
        files.clear();
        service.dispose();
      }
    },
  });
}
