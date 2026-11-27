<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import type { Project, MotionSpanOptions } from '../../../packages/document/src';
  import type { MotionRotation } from '../../../packages/document/src/motion-rotation';
  import type { MotionEase } from '../../../packages/document/src/motion-ease';
  import MotionEasing from './MotionEasing.svelte';
  import { graphicGroupOptions, liveCreationIssue, type LiveCreationInput } from './live-creation';
  let {
    snapshot,
    at,
    track,
    apply,
  }: {
    snapshot: Project;
    at: number;
    track: string;
    apply: (input: LiveCreationInput, validate: () => void) => void;
  } = $props();
  const original = untrack(() => ({ snapshot, at, track, apply }));
  const pairs = original.snapshot.layers.flatMap((layer) =>
    layer.keys.slice(1).flatMap((key, i) => {
      const start = layer.keys[i].frame,
        end = key.frame;
      return liveCreationIssue(original.snapshot, layer.id, start, end) &&
        liveCreationIssue(original.snapshot, layer.id, start, end, 'groups')
        ? []
        : [{ id: layer.id, start, end }];
    }),
  );
  const initial =
    pairs.find((p) => p.id === original.track && p.start <= original.at && p.end >= original.at) ??
    pairs.find((p) => p.id === original.track) ??
    pairs[0] ??
    original.snapshot.layers.flatMap((layer) =>
      layer.keys.slice(1).flatMap((key, i) => {
        const a = layer.keys[i];
        return layer.visible &&
          !layer.locked &&
          a.shapes.length &&
          key.shapes.length &&
          [a, key].some((k) => k.shapes.some((s) => s.kind === 'symbol'))
          ? [{ id: layer.id, start: a.frame, end: key.frame }]
          : [];
      }),
    )[0];
  let start = $state(initial ? initial.start + 1 : original.at + 1),
    end = $state(initial ? initial.end + 1 : Math.min(original.snapshot.duration, original.at + 3));
  let chosen = $state<string[]>(initial ? [initial.id] : []),
    ease = $state<MotionEase>('linear'),
    settings = $state<string[]>([]);
  let motionMode = $state<'plain' | 'groups' | 'group-graphics' | 'group-graphic-orbit' | 'graphics' | 'movies' | 'movie-trees'>('plain'),
    direction = $state<MotionRotation['direction']>('shortest'),
    turns = $state(0),
    nestedMovies = $state(false),
    movieMembers = $state(false),
    uniformScale = $state(false),
    axisScale = $state(false),
    shear = $state(false);
  let message = $state('Choose authored endpoints and complete root tracks.'),
    creating = $state(false);
  let revision = 0,
    alive = true;
  const optionsList: readonly [keyof MotionSpanOptions, string][] = [
    ['affine', 'Scale and skew'],
    ['paint', 'Paint colors'],
    ['nodes', 'Matching path nodes'],
    ['primitives', 'Primitive geometry'],
    ['strokeWidth', 'Stroke width'],
    ['strokeColor', 'Stroke color (geometry timing)'],
    ['pivots', 'Pivot interpolation'],
    [
      'defaultPivots',
      'Use authoring-box defaults for missing pivots (requires pivot interpolation)',
    ],
    ['gradientGeometry', 'Gradient geometry'],
    ['gradientBasis', 'Gradient basis'],
    ['gradientStops', 'Resample gradient stops (requires paint)'],
    ['gradientPremultiplied', 'Opacity-weighted gradient colors (requires paint)'],
    ['contourAreas', 'Reject contour area collapse'],
    ['contourEdges', 'Reject collapsed edges'],
    ['contourContacts', 'Reject contour contacts'],
    ['curveTangents', 'Reject stationary or reversing curve tangents'],
    ['curveSelfContacts', 'Reject single-curve self contacts'],
  ];
  const scaling = $derived({
    ...(uniformScale ? { uniformGroupScale: true } : {}),
    ...(axisScale ? { axisGroupScale: true } : {}),
    ...(shear ? { axisGroupShear: true } : {}),
  });
  const valid = $derived(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      chosen.length > 0 &&
      chosen.every(
        (id) => !liveCreationIssue(original.snapshot, id, start - 1, end - 1, motionMode, scaling, settings.includes('affine'), nestedMovies, movieMembers),
      ),
  );
  function change() {
    revision++;
    message = 'Ready to create. Existing keys and artwork stay unchanged.';
  }
  function create() {
    if (creating) return;
    if (!['plain', 'groups', 'group-graphics', 'group-graphic-orbit', 'graphics', 'movies', 'movie-trees'].includes(motionMode)) {
      message = 'Choose a supported motion mode.';
      return;
    }
    const input: LiveCreationInput = {
      start: start - 1,
      end: end - 1,
      tracks: [...chosen],
      ease: typeof ease === 'object' ? { ...ease } : ease,
      ...(settings.length ? { options: Object.fromEntries(settings.map((k) => [k, true])) } : {}),
      ...(motionMode === 'graphics' || motionMode === 'movies' || motionMode === 'movie-trees'
        ? { symbolContinuity: motionMode }
        : {}),
      ...graphicGroupOptions(motionMode, scaling, nestedMovies, movieMembers),
      ...(motionMode === 'groups'
        ? {
            rotation: {
              direction,
              turns,
              rigidGroups: true,
              ...scaling,
            },
          }
        : {}),
    };
    const owned = revision,
      stamp = JSON.stringify([
        start,
        end,
        chosen,
        ease,
        settings,
        motionMode,
        direction,
        turns,
        uniformScale,
        axisScale,
        shear,
      ]);
    const validate = () => {
      if (
        !alive ||
        revision !== owned ||
        JSON.stringify([
          start,
          end,
          chosen,
          ease,
          settings,
          motionMode,
          direction,
          turns,
          uniformScale,
          axisScale,
          shear,
        ]) !== stamp
      )
        throw Error('Live tween choices changed. Try again.');
    };
    creating = true;
    try {
      validate();
      original.apply(input, validate);
    } catch (cause) {
      if (alive) message = String(cause);
    } finally {
      creating = false;
    }
  }
  onDestroy(() => {
    alive = false;
    revision++;
  });
</script>

<h2>Create live tween</h2>
<p>Animate between two existing keys without baking interior keys or removing artwork.</p>
<label
  >Start frame<input
    aria-label="Live tween start frame"
    type="number"
    min="1"
    max={original.snapshot.duration}
    step="1"
    value={start}
    oninput={(e) => {
      start = e.currentTarget.valueAsNumber;
      change();
    }}
  /></label
>
<label
  >End frame<input
    aria-label="Live tween end frame"
    type="number"
    min="1"
    max={original.snapshot.duration}
    step="1"
    value={end}
    oninput={(e) => {
      end = e.currentTarget.valueAsNumber;
      change();
    }}
  /></label
>
<label
  >Motion mode<select
    aria-label="Live tween motion mode"
    value={motionMode}
    onchange={(e) => {
      motionMode = e.currentTarget.value as
        'plain' | 'groups' | 'group-graphics' | 'group-graphic-orbit' | 'graphics' | 'movies' | 'movie-trees';
      change();
    }}
  >
    <option value="plain">Plain roots</option><option value="groups">Complete outer groups</option>
    <option value="group-graphic-orbit">Graphic groups (rotate around saved pivot)</option>
    <option value="group-graphics">Complete groups with graphic symbols (translation)</option>
    <option value="graphics">Graphic symbols (loop / once / single frame)</option>
    <option value="movies">Movie clips (independent playback)</option>
    <option value="movie-trees">Nested movie clips (independent playback)</option>
  </select></label
>
{#if motionMode === 'graphics'}
  <p>
    Preserves each graphic’s existing playback mode and authored endpoint clocks. End clocks must
    match elapsed graphic playback from the start. Edit authored instance settings to correct a
    mismatch; this command never repairs clocks. Movie clips, buttons and grouped instances are
    unavailable.
  </p>
{/if}
{#if motionMode === 'movies'}
  <p>
    Moves movie clips while their contents play independently. Both endpoints must use movie
    playback with the same first-frame setting. Clips containing buttons or other movie clips, and
    grouped instances, are unavailable. Existing playback settings stay unchanged.
  </p>
{/if}
{#if motionMode === 'movie-trees'}
  <p>
    Moves movie clips containing other movie clips, including through graphic symbols. Each movie
    keeps its independent playback clock. Both endpoints must use movie playback with the same
    first-frame setting. Buttons and grouped instances are unavailable. Existing instance settings
    and library artwork stay unchanged.
  </p>
{/if}
{#if motionMode === 'groups' || motionMode === 'group-graphic-orbit'}
  <fieldset>
    <legend>Group motion</legend>
    {#if motionMode === 'groups'}
    <label
      >Rotation direction<select
        aria-label="Live group rotation direction"
        value={direction}
        onchange={(e) => {
          direction = e.currentTarget.value as MotionRotation['direction'];
          change();
        }}
      >
        <option value="shortest">Shortest</option><option value="clockwise">Clockwise</option
        ><option value="counterclockwise">Counterclockwise</option>
      </select></label
    >
    <label
      >Extra whole turns<input
        aria-label="Live group extra turns"
        type="number"
        min="0"
        step="1"
        value={turns}
        oninput={(e) => {
          turns = e.currentTarget.valueAsNumber;
          change();
        }}
      /></label
    >
    {/if}
    <label
      ><input
        type="checkbox"
        aria-label="Live group uniform scaling"
        checked={uniformScale}
        onchange={(e) => {
          uniformScale = e.currentTarget.checked;
          change();
        }}
      />Uniform group scaling</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Live group independent axis scaling"
        checked={axisScale}
        onchange={(e) => {
          axisScale = e.currentTarget.checked;
          change();
        }}
      />Independent group axis scaling</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Live group shared shear"
        checked={shear}
        onchange={(e) => {
          shear = e.currentTarget.checked;
          change();
        }}
      />Shared group shear (requires independent axis scaling)</label
    >
    {#if motionMode === 'group-graphic-orbit'}
      <label><input type="checkbox" bind:checked={nestedMovies} onchange={change} /> Play nested movie clips independently</label>
      {#if nestedMovies}
        <label><input type="checkbox" bind:checked={movieMembers} onchange={change} /> Include movie clips placed directly in the group</label>
      {/if}
      <small>Scaling requires Scale and skew under Interpolation options.</small>
    {:else}
    <small
      >Complete original outer groups only. Each group orbits its first original member; loose roots
      move independently. Saved/custom group pivot orbits and inner-level motion are unavailable.
      Options and dependencies remain explicit.</small
    >
    {/if}
  </fieldset>
{/if}
<fieldset>
  <legend>Complete root tracks</legend>
  {#each original.snapshot.layers as layer}
    {@const issue = liveCreationIssue(original.snapshot, layer.id, start - 1, end - 1, motionMode, scaling, settings.includes('affine'), nestedMovies, movieMembers)}
    <label
      ><input
        type="checkbox"
        aria-label={`Create live track ${layer.name}`}
        checked={chosen.includes(layer.id)}
        disabled={!!issue && !chosen.includes(layer.id)}
        onchange={(e) => {
          chosen = e.currentTarget.checked
            ? [...chosen, layer.id]
            : chosen.filter((id) => id !== layer.id);
          change();
        }}
      />{layer.name}</label
    >
    <small
      >Authored keys: {layer.keys
        .map((k) => `${k.frame + 1}${k.shapes.length ? '' : ' (blank)'}`)
        .join(', ')}. {issue ??
        'Endpoint structure is available; geometry is checked before creation.'}</small
    >
  {/each}
</fieldset>
<div oninput={change} onchange={change}>
  <MotionEasing bind:value={ease} label="Live tween easing" />
</div>
<details>
  <summary>Interpolation options</summary>
  {#each optionsList as [name, label]}
    <label
      ><input
        type="checkbox"
        aria-label={`Live tween ${label}`}
        data-live-option={name}
        checked={settings.includes(name)}
        onchange={(e) => {
          settings = e.currentTarget.checked
            ? [...settings, name]
            : settings.filter((k) => k !== name);
          change();
        }}
      />{label}</label
    >
  {/each}
  <small
    >Options are explicit. Contour/curve guards require matching nodes and do not certify all
    topology.</small
  >
</details>
<p>
  Live tweens support stage playback, Test Movie and single-frame PNG. Other live exports are
  unavailable.
</p>
<button disabled={!valid || creating} onclick={create}>Create live tween</button>
<p role="status">{message}</p>

<style>
  label {
    display: block;
    margin: 0.6rem 0;
  }
  fieldset,
  details {
    margin: 1rem 0;
  }
  small {
    display: block;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
