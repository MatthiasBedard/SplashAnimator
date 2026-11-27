<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import MotionEasing from './MotionEasing.svelte';
  import type { MotionEase } from '../../../packages/document/src/motion-ease';
  import type { TimelineTweenInput, TweenKind } from './timeline-tween';
  let {
    kind,
    name,
    start,
    end,
    duration,
    initialEase,
    initialAffine,
    timingOnly,
    apply,
    cancel,
  }: {
    kind: TweenKind;
    name: string;
    start: number;
    end: number;
    duration: number;
    initialEase: MotionEase;
    initialAffine: boolean;
    timingOnly?: boolean;
    apply: (input: TimelineTweenInput, validate: () => void) => void;
    cancel: () => void;
  } = $props();
  const original = untrack(() => ({
    kind,
    name,
    start,
    end,
    duration,
    initialEase,
    initialAffine,
    timingOnly,
    apply,
    cancel,
  }));
  let first = $state(original.start + 1),
    last = $state(original.end + 1),
    affine = $state(original.initialAffine),
    createEndpoints = $state(original.kind === 'shape'),
    ease = $state.raw<MotionEase>(original.initialEase),
    message = $state('');
  let revision = 0,
    alive = true;
  onDestroy(() => {
    alive = false;
    revision++;
  });
  function submit() {
    const owned = revision,
      input: TimelineTweenInput = {
        kind: original.kind,
        start: first - 1,
        end: last - 1,
        affine,
        createEndpoints,
        ease,
      };
    const stamp = JSON.stringify(input);
    const validate = () => {
      if (
        !alive ||
        owned !== revision ||
        JSON.stringify({
          kind: original.kind,
          start: first - 1,
          end: last - 1,
          affine,
          createEndpoints,
          ease,
        }) !== stamp
      )
        throw Error('Tween settings changed. Apply the current settings again.');
    };
    try {
      validate();
      original.apply(input, validate);
    } catch (cause) {
      if (alive) message = String(cause);
    }
  }
</script>

<h2>{original.timingOnly ? 'Edit motion tween easing' : `Convert to ${original.kind} tween`}</h2>
<p>{original.name}</p>
<form
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  {#if !original.timingOnly}
  <label
    >Start frame<input
      type="number"
      min="1"
      max={original.duration}
      aria-label="Tween start frame"
      value={first}
      oninput={(e) => {
        revision++;
        first = e.currentTarget.valueAsNumber;
      }}
    /></label
  >
  <label
    >End frame<input
      type="number"
      min="1"
      max={original.duration}
      aria-label="Tween end frame"
      value={last}
      oninput={(e) => {
        revision++;
        last = e.currentTarget.valueAsNumber;
      }}
    /></label
  >
  {/if}
  <MotionEasing
    bind:value={
      () => ease,
      (value) => {
        revision++;
        ease = value;
      }
    }
    label="Tween easing"
    help={original.timingOnly ? "This curve applies when you add an endpoint keyframe." : "Changes apply to this tween when you create it."}
  />
  {#if !original.timingOnly}
  <label
    ><input
      type="checkbox"
      aria-label="Tween scale and skew"
      checked={affine}
      onchange={(e) => {
        revision++;
        affine = e.currentTarget.checked;
      }}
    />Allow scale and skew</label
  >
  <label
    ><input
      type="checkbox"
      aria-label="Create matching tween endpoints"
      checked={createEndpoints}
      onchange={(e) => {
        revision++;
        createEndpoints = e.currentTarget.checked;
      }}
    />Create missing matching endpoint keys</label
  >
  <p>
    {original.kind === 'shape'
      ? 'Interpolates compatible vector nodes, primitive dimensions, stroke widths and paint. Symbols, text, bitmaps and groups require editable vector artwork first.'
      : 'Interpolates position, rotation, opacity and paint. Existing artwork types and identities must match at the endpoints.'}
  </p>
  <p>
    {original.kind === 'motion'
      ? 'If the end key is missing, the tween holds its starting pose until you insert a keyframe. Enable matching keys to create the endpoint now.'
      : 'Creates a live tween between endpoint keys. Other authored keys are preserved.'}
  </p>
  {/if}
  {#if message}<p role="alert">{message}</p>{/if}
  <button type="submit">{original.timingOnly ? "Apply easing" : `Create ${original.kind} tween`}</button><button
    type="button"
    onclick={original.cancel}>Cancel</button
  >
</form>

<style>
  label {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin: 0.8rem 0;
  }
  p {
    max-width: 34rem;
  }
  button {
    margin: 0.4rem;
  }
</style>
