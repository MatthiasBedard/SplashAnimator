import { spawn as nodeSpawn } from 'node:child_process';
import {
  prepareFFmpegProcess,
  runFFmpegProcess,
  type FFmpegSpawn,
  type FFmpegProcessPlan,
} from './ffmpeg-process';
import { withFFmpegStage } from './ffmpeg-stage';
import { ffmpegExecutableSignal, verifyFFmpegExecutable } from './ffmpeg-executable';

export interface FFmpegStagedProcessOptions {
  /** Original caller authority for this exact selected program, not a command
   * string taken from public archive/display metadata. Must remain synchronous. */
  validateExecutable: (executable: string) => void;
  /** Explicit optional original selected-file ownership; omission preserves the
   * existing caller-owned executable-validation path. */
  program?: object;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxDiagnostics?: number;
}
/** Explicit Node-only invocation over the original privately owned stage. No
 * UI/endpoint, executable discovery/install, automatic execution or publication.
 * A stage lease outlives termination requests and remains until actual child
 * close. Full input hashes are checked at preparation/completion boundaries;
 * streaming callbacks use only source/path/program admission. */
export function runStagedFFmpeg(
  stage: object,
  options: FFmpegStagedProcessOptions,
  spawn: FFmpegSpawn = nodeSpawn,
) {
  const started = performance.now(),
    Controller = AbortController,
    Spawn = spawn,
    throwIfAborted = AbortSignal.prototype.throwIfAborted,
    reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!,
    add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener,
    abort = Controller.prototype.abort;
  let finalAdmission: (() => void) | undefined;
  return withFFmpegStage(
    stage,
    async (lease) => {
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Reflect.ownKeys(options).some(
          (key) =>
            typeof key !== 'string' ||
            ![
              'validateExecutable',
              'program',
              'signal',
              'timeoutMs',
              'maxBytes',
              'maxDiagnostics',
            ].includes(key),
        )
      )
        throw Error('Unexpected staged FFmpeg options.');
      const {
        validateExecutable,
        program,
        signal,
        timeoutMs = 60000,
        maxBytes = 512 * 1024 * 1024,
        maxDiagnostics = 256 * 1024,
      } = options;
      if (
        typeof validateExecutable !== 'function' ||
        typeof Spawn !== 'function' ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60000 ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > 512 * 1024 * 1024 ||
        !Number.isSafeInteger(maxDiagnostics) ||
        maxDiagnostics < 1 ||
        maxDiagnostics > 1024 * 1024 ||
        (signal !== undefined && !(signal instanceof AbortSignal))
      )
        throw Error('Invalid staged FFmpeg authority, limits or dependencies.');
      const controller = new Controller(),
        stageSignal = lease.signal,
        programSignal = program === undefined ? undefined : ffmpegExecutableSignal(program);
      const abortCaller = () =>
        abort.call(controller, signal ? reason.call(signal) : Error('Staged FFmpeg cancelled.'));
      const abortStage = () => abort.call(controller, reason.call(stageSignal));
      const abortProgram = () => abort.call(controller, reason.call(programSignal!));
      let plan: FFmpegProcessPlan | undefined;
      const alive = () => {
        if (signal) throwIfAborted.call(signal);
        throwIfAborted.call(stageSignal);
        if (programSignal) throwIfAborted.call(programSignal);
        throwIfAborted.call(controller.signal);
        if (performance.now() - started >= timeoutMs) throw Error('Staged FFmpeg timed out.');
      };
      try {
        if (signal) add.call(signal, 'abort', abortCaller, { once: true });
        add.call(stageSignal, 'abort', abortStage, { once: true });
        if (programSignal) add.call(programSignal, 'abort', abortProgram, { once: true });
        alive();
        const { settings, executable, directory } = lease.metadata();
        if (program !== undefined) verifyFFmpegExecutable(program, executable, true);
        const validate = () => {
          alive();
          lease.validate();
          if (program !== undefined) verifyFFmpegExecutable(program, executable);
          const result = validateExecutable(executable) as unknown;
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            void Promise.resolve(result).catch(() => {});
            throw Error('FFmpeg executable authority must be synchronous.');
          }
          alive();
          lease.validate();
          if (program !== undefined) verifyFFmpegExecutable(program, executable);
        };
        finalAdmission = validate;
        validate();
        plan = prepareFFmpegProcess(settings, { executable, directory }, validate);
        validate();
        const remaining = Math.max(1, Math.ceil(timeoutMs - (performance.now() - started)));
        const result = await runFFmpegProcess(
          plan,
          { signal: controller.signal, timeoutMs: remaining, maxBytes, maxDiagnostics },
          Spawn,
        );
        // The process promise settles only after close (or before any child exists).
        // Rehash at this boundary, never once per stdout/stderr chunk.
        lease.verify();
        if (program !== undefined) verifyFFmpegExecutable(program, executable, true);
        validate();
        return result;
      } finally {
        plan?.dispose();
        if (signal) remove.call(signal, 'abort', abortCaller);
        remove.call(stageSignal, 'abort', abortStage);
        if (programSignal) remove.call(programSignal, 'abort', abortProgram);
      }
    },
    () => finalAdmission!(),
  );
}
