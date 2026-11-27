<script lang="ts">
  let {
    label,
    caption = label,
    value,
    min,
    max,
    step = 1,
    numberStep = step,
    disabled = false,
    emptyValue = 0,
    liveNumber = false,
    scope,
    onchange,
  }: {
    label: string;
    caption?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    numberStep?: number | 'any';
    disabled?: boolean;
    emptyValue?: number;
    liveNumber?: boolean;
    scope?: unknown;
    onchange: (value: number) => void;
  } = $props();
  let draft = $state.raw<{ scope: unknown; label: string; text: string } | null>(null),
    cancelled = false;
  const text = $derived(
    draft && draft.scope === scope && draft.label === label ? draft.text : String(value),
  );
  function begin() {
    cancelled = false;
    draft = { scope, label, text: String(value) };
  }
  function input(event: Event) {
    if (cancelled) return;
    draft = {
      ...(draft ?? { scope, label }),
      text: (event.currentTarget as HTMLInputElement).value,
    };
    const field = event.currentTarget as HTMLInputElement;
    if (
      liveNumber &&
      field.type === 'number' &&
      !disabled &&
      draft.scope === scope &&
      draft.label === label
    ) {
      const next = field.value === '' ? emptyValue : Number(field.value);
      if (!Object.is(next, value)) onchange(next);
    }
  }
  function commit(event: Event) {
    const field = event.currentTarget as HTMLInputElement;
    if (cancelled || disabled || (draft && (draft.scope !== scope || draft.label !== label))) {
      draft = null;
      field.value = String(value);
      return;
    }
    const next = field.value === '' ? emptyValue : Number(field.value);
    draft = null;
    if (!Object.is(next, value)) onchange(next);
  }
  function cancel() {
    if (draft) {
      draft = null;
      cancelled = true;
    }
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (!draft || cancelled) begin();
  }
</script>

<div class="number-slider">
  <label
    >{caption}<input
      type="number"
      aria-label={label}
      {min}
      {max}
      step={numberStep}
      {disabled}
      value={text}
      onfocus={begin}
      oninput={input}
      onchange={commit}
      onkeydown={key}
    /></label
  >
  <input
    type="range"
    aria-label={`${label} slider`}
    {min}
    {max}
    step={numberStep === 'any' ? 'any' : step}
    {disabled}
    value={Number(text)}
    onpointerdown={begin}
    onkeydown={key}
    oninput={input}
    onchange={commit}
    onpointercancel={cancel}
    onlostpointercapture={cancel}
  />
</div>

<style>
  .number-slider {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    margin: 8px 0;
  }
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  input[type='number'] {
    width: 75px;
  }
  input[type='range'] {
    width: 100%;
    min-width: 0;
  }
</style>
