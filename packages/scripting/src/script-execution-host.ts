export const scriptWorkStepName = '__splashWorkStep';
export const scriptPreparedFrameName = '__splashPreparedFrame';
// Keep capability bindings outside the authored function so scripts can shadow them locally.
export const scriptFrameFactoryStart =
  `(function(){"use strict";const stage=arguments[0],runtime=arguments[1];return function(timeline,state,input,splashText,${scriptWorkStepName}){\n`;
export const scriptFrameFactoryEnd = '\n};})';
export const scriptLoopLimit = 100_000;
export const scriptFunctionLimit = 100_000;
export const scriptFunctionDepth = 256;

export function assertBrowserScriptExecution(): void {
  if ('__TAURI_INTERNALS__' in globalThis || '__TAURI__' in globalThis)
    throw new Error('Script preview is not enabled in the native application.');
}
