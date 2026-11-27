<script module lang="ts">
  export type CaptureAudio = { channels: 1 | 2; load: (path: string, signal: AbortSignal) => Promise<Blob> };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Project } from '@splash/document';
  import type { PNGFrameRange } from './export-png';
  import { focusDialogFooter, showFocusedDialog, wrapDialogTab } from './dialog-focus';

  let { validate, close, capture }: { validate: () => void; close: () => void;
    capture?: { snapshot: Project; range: PNGFrameRange; scale: number; transparent: boolean; audio?: CaptureAudio };
  } = $props();
  let phase = $state<'idle' | 'choosing' | 'capturing' | 'encoding' | 'saving'>('idle');
  let message = $state('');
  let error = $state('');
  let includeAudio = $state(false);
  const formats = {
    matroska: { label: 'lossless Matroska', saving: 'Matroska', option: 'Lossless Matroska (.mkv)' },
    quickTime: { label: 'lossless QuickTime MOV', saving: 'QuickTime MOV', option: 'QuickTime Animation (.mov)' },
    avi: { label: 'lossless AVI', saving: 'AVI', option: 'Lossless AVI (.avi)' },
    mpeg: { label: 'MPEG-2', saving: 'MPEG-2', option: 'MPEG-2 (.mpg)' },
    hevc: { label: 'HEVC MP4', saving: 'HEVC MP4', option: 'HEVC / H.265 (.mp4)' },
  } as const;
  let format = $state<keyof typeof formats>('matroska');
  let dialog = $state<HTMLDialogElement>();
  let job: AbortController | undefined;

  onDestroy(() => job?.abort());
  $effect(() => { if (phase !== 'choosing') void focusDialogFooter(dialog); });

  async function run() {
    if (job) return;
    const request = new AbortController();
    const input = capture;
    const selectedFormat = format;
    const selectedProfile = formats[selectedFormat];
    const soundtrack = includeAudio ? input?.audio : undefined;
    const active = () => {
      request.signal.throwIfAborted();
      validate();
      if (format !== selectedFormat) throw Error('The desktop output format changed. Retry export.');
    };
    job = request;
    phase = 'choosing';
    error = '';
    message = input ? 'Choose the FFmpeg executable and a new destination.' :
      'Choose the input manifest, FFmpeg executable and a new destination.';
    let id: string | undefined;
    let discard: (() => Promise<void>) | undefined;
    let cancellation: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      validate();
      if (includeAudio && !soundtrack) throw Error('The project audio source changed. Reopen export.');
      const { invoke } = await import('@tauri-apps/api/core');
      request.signal.throwIfAborted();
      const plan = input ? (await import('./ffmpeg-bundle-plan')).ffmpegBundlePlan(
        input.snapshot, input.range, input.scale, input.transparent, !!soundtrack) : undefined;
      const video = plan?.video;
      const audio = plan?.audio && soundtrack ? {
        ...plan.audio, frames: plan.audio.end - plan.audio.start, channels: soundtrack.channels,
      } : undefined;
      active();
      const selection = await invoke<{
        id: string; frameCount: number; width: number; height: number; audioChannels: 1 | 2 | null;
        format: typeof selectedFormat;
      } | null>(video ? 'ffmpeg_choose_capture' : 'ffmpeg_choose', { format: selectedFormat, ...(video && { video, audio }) });
      if (!selection) {
        message = 'FFmpeg export cancelled.';
        return;
      }
      id = selection.id;
      discard = () => cancellation ??= invoke<void>('ffmpeg_cancel', { id });
      request.signal.addEventListener('abort', () => { void discard?.().catch(() => {}); }, { once: true });
      active();
      if (selection.format !== selectedFormat) throw Error('The desktop output format changed. Retry export.');
      if (input && video) {
        if (selection.frameCount !== video.frameCount || selection.width !== video.width ||
            selection.height !== video.height || selection.audioChannels !== (audio?.channels ?? null))
          throw Error('The desktop capture settings changed. Reopen export.');
        phase = 'capturing';
        message = 'Preparing desktop frame capture…';
        timer = setTimeout(() => request.abort(Error('Desktop capture timed out.')), 60000);
        if (soundtrack && audio) {
          message = 'Preparing project audio…';
          const deadline = performance.now() + 60000;
          const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
          const { prepareProjectAudio } = await import('../../../packages/audio/src/project-preview');
          active();
          const mixed = await prepareProjectAudio(input.snapshot, async (path, signal) => {
            active();
            const blob = await soundtrack.load(path, signal);
            active();
            return blob;
          }, {
            signal: request.signal, timeoutMs: remaining(), startFrame: video.sourceStartFrame,
            endFrame: video.sourceEndFrameExclusive, sampleRate: audio.sampleRate, channelCount: audio.channels,
          });
          active();
          if (mixed.startSample !== audio.start || mixed.endSample !== audio.end ||
              mixed.channels.length !== audio.channels || mixed.channels.some(channel => channel.length !== audio.frames))
            throw Error('Prepared WAV timing changed.');
          const { encodePcm16WavAsync } = await import('../../../packages/audio/src/wav-encode-async');
          active();
          const wav = await encodePcm16WavAsync(mixed.channels, audio.sampleRate, {
            signal: request.signal, timeoutMs: remaining(),
          });
          active();
          const buffer = wav.buffer;
          if (!(buffer instanceof ArrayBuffer) || wav.byteOffset !== 0 || wav.byteLength !== buffer.byteLength)
            throw Error('Prepared WAV does not own its complete bytes.');
          await invoke('ffmpeg_push_audio', buffer, { headers: { 'x-splash-job': selection.id } });
          active();
        }
        const { captureDesktopPNGSequence } = await import('./desktop-png');
        await captureDesktopPNGSequence(input.snapshot, input.range, input.scale, input.transparent,
          request.signal, active, async (frame, png) => {
            if (png.size > 512 * 1024 * 1024) throw Error('Desktop PNG exceeds its input budget.');
            const bytes = await png.arrayBuffer();
            active();
            await invoke('ffmpeg_push_frame', bytes, { headers: {
              'x-splash-job': selection.id, 'x-splash-frame': String(frame + 1),
            } });
            message = `Captured ${frame - input.range.start + 1} of ${video.frameCount} frames…`;
          });
        clearTimeout(timer);
        active();
      }
      phase = 'encoding';
      const audioLabel = selection.audioChannels === 1 ? ' with mono PCM audio' :
        selection.audioChannels === 2 ? ' with stereo PCM audio' : '';
      message = `Encoding ${selection.frameCount} frames at ${selection.width} × ${selection.height}${audioLabel}…`;
      await invoke('ffmpeg_encode', { id });
      active();
      phase = 'saving';
      message = `Saving the complete ${selectedProfile.saving} file…`;
      await invoke('ffmpeg_publish', { id });
      id = undefined;
      message = `Saved ${selection.frameCount} frames as ${selectedProfile.label}${audioLabel}.`;
    } catch (cause) {
      if (request.signal.aborted && request.signal.reason?.name === 'AbortError') message = 'FFmpeg export cancelled.';
      else {
        error = String(cause);
        message = '';
      }
    } finally {
      clearTimeout(timer);
      if (id) {
        try { await discard?.(); }
        catch (cause) { error = 'Could not release the FFmpeg job. ' + String(cause); }
      }
      job = undefined;
      phase = 'idle';
    }
  }
</script>

  <dialog class="panel" bind:this={dialog} use:showFocusedDialog={'select'}
    aria-label={capture ? 'Encode desktop timeline' : 'Encode FFmpeg input bundle'}
    onkeydown={wrapDialogTab} oncancel={event => { event.preventDefault(); if (phase === 'idle') close(); }}>
    <header>
      <h2>{capture ? 'Encode desktop timeline' : 'Encode FFmpeg input bundle'}</h2>
        <button type="button" disabled={phase !== 'idle'} onclick={close}>Close</button>
    </header>
    <label>Desktop video format
      <select bind:value={format} disabled={phase !== 'idle'}>
        {#each Object.entries(formats) as [id, profile] (id)}
          <option value={id}>{profile.option}</option>
        {/each}
      </select>
    </label>
    {#if format === 'mpeg'}
      <p>MPEG-2 fills transparent areas with white. Use even output dimensions and a standard MPEG-2 frame rate.</p>
    {:else if format === 'hevc'}
      <p>HEVC fills transparent areas with white. It requires FFmpeg with libx265, plus PCM in MP4 support if you include audio.</p>
    {/if}
    {#if capture}
      <p>Frames {capture.range.start + 1}–{capture.range.end + 1} · {capture.scale}×</p>
      {#if capture.audio}
        <label><input type="checkbox" bind:checked={includeAudio} disabled={phase !== 'idle'} />Include project audio (48 kHz PCM)</label>
      {:else if capture.snapshot.audioClips?.length}
        <p>Save the project before including its audio.</p>
      {/if}
    {:else}
      <p>Choose ffmpeg.json from an extracted Splash Animator input bundle. If the bundle includes mixed audio, keep its audio.wav beside the PNG frames. Select your FFmpeg executable and a new destination file.</p>
    {/if}
    {#if error}<p role="alert">{error}</p>{/if}
    <p role="status">{message}</p>
    <footer>
      {#if phase === 'idle'}
        <button type="button" onclick={run}>Choose files and encode…</button>
      {:else if phase === 'encoding' || phase === 'capturing' || phase === 'saving'}
        <button type="button" onclick={() => job?.abort()}>{phase === 'saving' ? 'Cancel save' : 'Cancel encoding'}</button>
      {/if}
    </footer>
  </dialog>

<style>
  .panel::backdrop {
    background: #0009;
  }
  .panel {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    background: #25272d;
    color: #eee;
    border: 1px solid #60636d;
    border-radius: 8px;
    padding: 20px;
    width: min(600px, 90vw);
    max-height: 85vh;
    overflow: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
  }
  h2 { font-size: 18px; margin: 0; }
  p { font-size: 13px; line-height: 1.5; }
  button { border-color: #777c8b; }
  [role='alert'] { color: #ffb8aa; }
</style>
