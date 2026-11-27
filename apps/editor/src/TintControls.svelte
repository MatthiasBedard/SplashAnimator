<script lang="ts">
  import type { Tint } from '@splash/document';
  import NumberSlider from './NumberSlider.svelte';
  let { label, tint, disabled, scope, reset = true, onchange }: {
    label: string; tint?: Tint; disabled: boolean; scope: unknown;
    reset?: boolean;
    onchange: (patch: Partial<Tint> | null) => void;
  } = $props();
</script>

<label class="property-line">Tint color<input type="color" aria-label={label+' tint color'}
  value={tint?.color??'#ffffff'} {disabled} onchange={e=>{
    const color=e.currentTarget.value;
    if(/^#[0-9a-f]{6}$/i.test(color))onchange({color});
  }}/></label>
<NumberSlider label={label+' tint amount'} caption="Tint (%)" value={(tint?.amount??0)*100}
  min={0} max={100} {disabled} {scope} onchange={value=>{
    if(Number.isFinite(value)&&value>=0&&value<=100)onchange({amount:value/100});
  }}/>
{#if tint && reset}<button {disabled} onclick={()=>onchange(null)}>Reset tint</button>{/if}
