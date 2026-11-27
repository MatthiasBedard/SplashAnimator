<script lang="ts">
  import { isDynamicTextBinding } from '../../../packages/document/src/dynamic-text';

  let { value, input = false, label = 'Dynamic text binding', disabled = false, change }: {
    value?: string;
    input?: boolean;
    label?: string;
    disabled?: boolean;
    change: (binding: string | undefined, editable: boolean) => void;
  } = $props();
  let error = $state('');

  function update(control: HTMLInputElement) {
    const name = control.value.trim();
    if (name && !isDynamicTextBinding(name)) {
      error = 'Use up to 64 letters, digits or underscores, starting with a letter or underscore.';
      control.value = value ?? '';
      return;
    }
    error = '';
    if ((name || undefined) !== value) change(name || undefined, !!name && input);
    control.value = value ?? '';
  }
</script>

<label class="property-line">
  {label}
  <input aria-label={label} {disabled} value={value ?? ''} placeholder="Static text"
    title='Use splashText.set("name", "value") in script preview. Clear the name to use static text.'
    onchange={(event) => update(event.currentTarget)} />
</label>
{#if value}
  <label class="property-line">
    Editable in script preview
    <input type="checkbox" {disabled} checked={input}
      onchange={(event) => change(value, event.currentTarget.checked)} />
  </label>
{/if}
{#if error}<small role="alert">{error}</small>{/if}
