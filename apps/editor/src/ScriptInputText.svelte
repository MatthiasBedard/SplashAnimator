<script lang="ts">
  import type { ScriptTextInput } from '../../../packages/scripting/src/input-text';
  import type { ScriptFieldPlacement } from './script-text-fields';

  let { binding, value, reset, busy, placement, deliver }: {
    binding: string;
    value: string;
    reset: number;
    busy: boolean;
    placement?: ScriptFieldPlacement;
    deliver: (input: ScriptTextInput) => void;
  } = $props();
  let field: HTMLTextAreaElement;
  let draft = $state('');
  let composing = $state(false);

  $effect(() => {
    void reset;
    draft = value;
    composing = false;
  });

  function submit() {
    if (busy || composing) return;
    deliver({
      binding, value: field.value, selectionStart: field.selectionStart,
      selectionEnd: field.selectionEnd, selectionDirection: field.selectionDirection,
    });
  }
</script>

<div class="script-text-field" class:stage={!!placement} style:--edit-background={placement?.editBackground}>
  <label style:transform={placement?.transform} style:width={placement?.width} style:height={placement?.height}>
    {#if !placement}{binding}{/if}
    <textarea bind:this={field} bind:value={draft} rows="2" maxlength="10000" wrap={placement?.wrap ?? 'soft'}
      aria-label={`Text input ${binding}`} data-script-stage-input={placement ? '' : undefined} readonly={busy}
      style:font={placement?.font} style:color={placement?.color} style:text-align={placement?.align}
      style:direction={placement?.direction} style:letter-spacing={placement?.letterSpacing}
      style:word-spacing={placement?.wordSpacing} style:font-kerning={placement?.kerning}
      oncompositionstart={() => composing = true}
      oncompositionend={() => composing = false}
      onkeydown={(event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || composing || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        submit();
      }}
    ></textarea>
  </label>
  <button type="button" style:left={placement?.buttonX} style:top={placement?.buttonY}
    disabled={busy || composing} onclick={submit}>Deliver {binding} and step</button>
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .stage label {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    margin: 0;
  }
  .stage textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    margin: 0;
    border-radius: 0;
    resize: none;
    overflow: hidden;
    outline: 1px solid #1273ad;
    background: transparent;
    -webkit-text-fill-color: transparent;
    cursor: text;
    pointer-events: auto;
  }
  .stage textarea:focus {
    background: var(--edit-background, #fff);
    overflow: auto;
    -webkit-text-fill-color: currentColor;
    outline: 2px solid #1273ad;
  }
  .stage button {
    position: absolute;
    visibility: hidden;
    pointer-events: auto;
  }
  .stage:focus-within {
    z-index: 1;
  }
  .stage:focus-within button {
    visibility: visible;
  }
</style>
