import { createScriptSession, type ScriptFrameSource } from '../../../packages/scripting/src/session';
import { cloneScriptState, type ScriptState, type ScriptTimelineConfig } from '../../../packages/scripting/src/timeline';

type ScriptArtwork = HTMLCanvasElement & { splashPresentScriptFrame?: (frame: number, tick: number) => void };
const canvas = document.querySelector<ScriptArtwork>('canvas')!;
const status = document.querySelector<HTMLElement>('#script-status')!;
const play = document.querySelector<HTMLButtonElement>('#script-play')!;
const step = document.querySelector<HTMLButtonElement>('#script-step')!;
const form = document.querySelector<HTMLFormElement>('#script-input')!;
const field = form.querySelector<HTMLInputElement>('input')!;
const send = form.querySelector<HTMLButtonElement>('button')!;
const entry = document.querySelector('#script-program')!;

try {
  const program = JSON.parse(entry.textContent ?? '') as {
    config: ScriptTimelineConfig; frames: ScriptFrameSource[]; worker: string;
  };
  entry.remove();
  const session = createScriptSession(program.config, program.frames, {}, 'entry',
    undefined, undefined, undefined, false, undefined, true,
    () => new Worker(url, { name: 'Splash bounded standalone script' }));
  const url = URL.createObjectURL(new Blob([program.worker], { type: 'text/javascript' }));
  let ready = false, playing = false, closed = false;
  let pending: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const controls = () => {
    play.disabled = !ready || closed;
    step.disabled = send.disabled = !ready || closed || !!pending || playing;
    play.textContent = playing ? 'Pause scripts' : 'Play scripts';
  };
  const stop = () => { playing = false; clearTimeout(timer); };
  const label = (frame: number, tick: number) => `Frame ${frame + 1} · Tick ${tick}`;
  async function advance(input?: ScriptState, changePlaying?: boolean) {
    if (!ready || closed || pending) return;
    const started = performance.now();
    const current = session.checkpoint().timeline;
    const job = new AbortController();
    pending = job;controls();
    try {
      const result = await session.runWithPresentation(1, {
        signal: job.signal, timeoutMs: 1000,
        ...(changePlaying !== undefined ? { playback: [{ tick: current.tick, playing: changePlaying }] } : {}),
        ...(input !== undefined ? { events: [{ tick: current.tick, data: input }] } : {}),
      });
      job.signal.throwIfAborted();
      const next = result.checkpoint.timeline;
      canvas.splashPresentScriptFrame!(next.frame, next.tick);
      status.textContent = label(next.frame, next.tick);
      if (!next.playing) stop();
      if (playing) timer = setTimeout(() => void advance(), Math.max(0, 1000 / program.config.fps - (performance.now() - started)));
    } catch (error) {
      stop();
      if (!closed) status.textContent = job.signal.aborted ? 'Script playback paused.' : String(error).slice(0, 2000);
    } finally { pending = undefined; controls(); }
  }
  function artworkReady() {
    ready = canvas.dataset.scriptArtwork === 'ready' && typeof canvas.splashPresentScriptFrame === 'function';
    status.textContent = ready ? 'Ready. Press Play scripts, Step script or Send JSON to run saved scripts.' : 'Artwork could not load.';
    controls();
  }
  if (canvas.dataset.scriptArtwork) artworkReady();
  else canvas.addEventListener('splash-script-artwork', artworkReady, { once: true });
  play.onclick = () => {
    if (playing) { stop(); pending?.abort(); controls(); return; }
    if (pending) return;
    playing = true;
    void advance(undefined, true);
  };
  step.onclick = () => { void advance(undefined, false); };
  form.onsubmit = event => {
    event.preventDefault();
    if (!ready || closed || pending || playing) return;
    try {
      if (field.value.length > 65536) throw Error('Script input exceeds 65,536 characters.');
      const input = cloneScriptState(JSON.parse(field.value));
      void advance(input, false);
    } catch (error) { status.textContent = String(error).slice(0, 2000); }
  };
  addEventListener('pagehide', () => {
    closed = true;stop();pending?.abort();URL.revokeObjectURL(url);controls();
  }, { once: true });
} catch (error) {
  status.textContent = String(error).slice(0, 2000);
}
