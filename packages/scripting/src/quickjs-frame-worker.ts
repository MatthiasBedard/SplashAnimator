import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { scriptFrameFactoryEnd, scriptFrameFactoryStart, scriptPreparedFrameName } from './script-execution-host';

const maxProgramLength = 8 * 1024 * 1024;
const maxResponseLength = 256 * 1024;
const guestHeapBytes = 16 * 1024 * 1024;
const maxInterruptChecks = 512;

self.onmessage = async ({ data, ports }: MessageEvent) => {
  self.onmessage = null;
  const port = ports[0];
  if (!port) return;
  try {
    const { program, source, timeoutMs, debug } = data;
    if (typeof program !== 'string' || !program.length || program.length > maxProgramLength ||
        typeof source !== 'string' || source.length > 256 * 1024 || typeof debug !== 'boolean' ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw Error('Invalid engine-limited frame request.');
    let deadline = performance.now() + timeoutMs;
    const module = await newQuickJSWASMModuleFromVariant(variant);
    const runtime = module.newRuntime();
    let response: unknown;
    try {
      runtime.setMemoryLimit(guestHeapBytes);
      runtime.setMaxStackSize(512 * 1024);
      let checks = 0, interrupted = false;
      runtime.setInterruptHandler(() => {
        interrupted ||= ++checks > maxInterruptChecks || performance.now() >= deadline;
        return interrupted;
      });
      const guest = runtime.newContext();
      try {
        const frame = guest.evalCode(
          // Preserve the two wrapper lines used to map guest errors to frame source.
          scriptFrameFactoryStart + '\n' + source + scriptFrameFactoryEnd,
          'splash-frame.js',
        );
        try {
          if (interrupted) throw Error('Script engine work limit exceeded.');
          if (frame.error) throw Error('The engine could not load the compiled frame.');
          guest.setProp(guest.global, scriptPreparedFrameName, frame.value);
        } finally {
          frame.dispose();
        }
        const driver = guest.evalCode(program, 'splash-bootstrap.js');
        try {
          if (interrupted) throw Error('Script engine work limit exceeded.');
          if (driver.error || guest.typeof(driver.value) !== 'function')
            throw Error('The engine could not start the frame driver.');
          let action: string | undefined;
          for (;;) {
            const argument = action === undefined ? undefined : guest.newString(action);
            try {
              const result = guest.callFunction(driver.value, guest.undefined, argument ? [argument] : []);
              try {
                if (interrupted) throw Error('Script engine work limit exceeded.');
                if (result.error) {
                  const message = guest.getProp(result.error, 'message');
                  try { throw Error(guest.getString(message).slice(0, 2000)); }
                  finally { message.dispose(); }
                }
                if (guest.typeof(result.value) !== 'string') throw Error('Invalid script engine response.');
                const output = guest.getString(result.value);
                if (output.length > maxResponseLength) throw Error('Script engine response exceeds its budget.');
                response = JSON.parse(output);
              } finally {
                result.dispose();
              }
            } finally {
              argument?.dispose();
            }
            if (!response || typeof response !== 'object' || !('paused' in response) || response.paused !== true)
              break;
            if (!debug) throw Error('Unexpected script engine pause.');
            action = await new Promise<string>((resolve, reject) => {
              port.onmessage = (event) => {
                if (!event.isTrusted) return;
                port.onmessage = null;
                const value: unknown = event.data;
                if (value === 'resume' || value === 'step' || value === 'into' || value === 'out') resolve(value);
                else reject(Error('Invalid debugger action.'));
              };
              port.postMessage(response);
            });
            deadline = performance.now() + timeoutMs;
          }
        } finally {
          driver.dispose();
        }
      } finally {
        guest.dispose();
      }
    } finally {
      runtime.dispose();
    }
    port.postMessage(response);
  } catch (error) {
    port.postMessage({ ok: false, error: String(error).slice(0, 2000) });
  } finally {
    port.onmessage = null;
    port.close();
  }
};
