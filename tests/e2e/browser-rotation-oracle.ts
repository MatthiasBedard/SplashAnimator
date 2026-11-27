import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import type { Project, SymbolDefinition } from '../../packages/document/src';
import type { SampledUnitRequest } from '../../packages/animation/src/selection-motion-owner';

let script: string | undefined;
/** Run the independent original-source API in the browser's Math implementation.
 * Node/Chromium transcendental results can differ by an ULP; candidate equality
 * must not be weakened to accommodate the test runner's different runtime.
 * This test-only bundle is injected in a fresh context, never into app source.
 */
export async function browserRotationOracle(
  page: Page,
  project: Project,
  requests: SampledUnitRequest[],
  degrees: number,
): Promise<Project> {
  await installRotationOracle(page);
  return page.evaluate(
    ({ project, requests, degrees }) =>
      (
        window as unknown as {
          __rotationTestOracle(
            project: Project,
            requests: SampledUnitRequest[],
            degrees: number,
          ): Project;
        }
      ).__rotationTestOracle(project, requests, degrees),
    { project, requests, degrees },
  );
}

export async function browserSymbolRotationOracle(
  page: Page,
  project: Project,
  requests: SampledUnitRequest[],
  degrees: number,
): Promise<SymbolDefinition> {
  await installRotationOracle(page);
  return page.evaluate(
    ({ project, requests, degrees }) =>
      (
        window as unknown as {
          __symbolRotationTestOracle(
            p: Project,
            r: SampledUnitRequest[],
            d: number,
          ): SymbolDefinition;
        }
      ).__symbolRotationTestOracle(project, requests, degrees),
    { project, requests, degrees },
  );
}

async function installRotationOracle(page: Page) {
  if (!script) {
    const { buildSync } = createRequire(import.meta.resolve('vite'))('esbuild') as {
      buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
    };
    script = buildSync({
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      tsconfig: 'tsconfig.json',
      stdin: {
        resolveDir: process.cwd(),
        sourcefile: 'rotation-test-oracle.ts',
        loader: 'ts',
        contents: `
        import {captureRememberedSelectionAuthoringFrame} from './packages/animation/src/selection-motion-owner';
        import {captureSymbolRememberedSelectionAuthoringFrame} from './packages/animation/src/symbol-selection-motion-owner';
        globalThis.__symbolRotationTestOracle=(project,requests,degrees)=>{
          const definition=project.symbols.find(s=>s.id==='selection');
          const capture=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition,symbols:project.symbols,assets:project.assets,revision:0,frame:4}));
          try{return capture.prepareRotation(requests,degrees);}finally{capture.dispose();}
        };
        globalThis.__rotationTestOracle=(project,requests,degrees)=>{
          const capture=captureRememberedSelectionAuthoringFrame(()=>({project,revision:0,frame:4}));
          try{return capture.prepareRotation(requests,degrees);}finally{capture.dispose();}
        };
      `,
      },
    }).outputFiles[0].text;
  }
  await page.addScriptTag({ content: script });
}
