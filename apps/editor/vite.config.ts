import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { projectServer } from './server';
export default defineConfig(({ command }) => ({
  root: 'apps/editor',
  // Keep development styles in the compiled component so a stale virtual CSS
  // request cannot fall back to serving raw, unscoped component source.
  plugins: [svelte({ emitCss: command === 'build' }), projectServer()],
  optimizeDeps: {
    include: [
      '@splash/geometry > polygon-clipping',
      'typescript',
      'quickjs-emscripten-core',
      '@jitl/quickjs-singlefile-browser-release-sync',
      'monaco-editor/editor/editor.api',
      'monaco-editor/languages/definitions/typescript/register',
      'monaco-editor/features/suggest/register',
      'monaco-editor/editor/contrib/suggest/browser/suggestController',
      'monaco-editor/features/hover/register',
      'monaco-editor/features/find/register',
      'monaco-editor/features/bracketMatching/register',
      'monaco-editor/features/toggleTabFocusMode/register',
    ],
  },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  // Keep each worker self-contained, including the QuickJS variant's lazy loader.
  worker: { rollupOptions: { output: { inlineDynamicImports: true } } },
  build: { outDir: '../../dist', emptyOutDir: true },
  clearScreen: false,
}));
