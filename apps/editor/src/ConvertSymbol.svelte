<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  let {
    kind,
    name,
    apply,
    cancel,
  }: {
    kind: 'graphic' | 'movie';
    name: string;
    apply: (
      name: string,
      mode: 'graphic' | 'movie',
      createLayer: boolean,
      validate: () => void,
    ) => Promise<void>;
    cancel: () => void;
  } = $props();
  const original = untrack(() => ({ kind, name, apply, cancel }));
  let label = $state(original.name),
    mode = $state(original.kind),
    createLayer = $state(false),
    message = $state(''),
    pending = $state(false);
  let revision = 0,
    alive = true;
  onDestroy(() => {
    alive = false;
    revision++;
  });
  async function submit() {
    if (pending) return;
    const owned = revision,
      value = label,
      playback = mode,
      newLayer = createLayer;
    const validate = () => {
      if (
        !alive ||
        revision !== owned ||
        label !== value ||
        mode !== playback ||
        createLayer !== newLayer
      )
        throw Error('Conversion settings changed. Convert the current selection again.');
    };
    pending = true;
    try {
      validate();
      await original.apply(value, playback, newLayer, validate);
    } catch (cause) {
      if (alive) message = String(cause);
    } finally {
      if (alive) pending = false;
    }
  }
</script>

<h2>Convert selection to symbol</h2>
<form
  onsubmit={(e) => {
    e.preventDefault();
    void submit();
  }}
>
  <label
    >Name<input
      aria-label="Symbol name"
      maxlength="200"
      value={label}
      oninput={(e) => {
        revision++;
        label = e.currentTarget.value;
      }}
    /></label
  >
  <label
    >Type<select
      aria-label="Symbol type"
      value={mode}
      onchange={(e) => {
        revision++;
        mode = e.currentTarget.value as 'graphic' | 'movie';
      }}
      ><option value="graphic">Graphic symbol</option><option value="movie">Movie clip</option
      ></select
    ></label
  >
  <label
    class="layer-option"
    title="Keep the symbol on its original layer unless checked. Paint layers switch to object drawing so they can contain symbols."
  >
    <input
      type="checkbox"
      aria-label="Create new layer"
      checked={createLayer}
      onchange={(e) => {
        revision++;
        createLayer = e.currentTarget.checked;
      }}
    />Create new layer
  </label>
  <p>
    Graphic symbols follow the parent timeline. Movie clips play independently in Test Movie and
    exports. Edit the new symbol’s artwork and timeline in the library.
  </p>
  {#if message}<p role="alert">{message}</p>{/if}
  <button type="submit" disabled={pending || !label.trim()}>Convert selection</button>
  <button type="button" onclick={original.cancel}>Cancel</button>
</form>

<style>
  form {
    display: grid;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 5px;
  }
  .layer-option {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  p {
    max-width: 460px;
  }
</style>
