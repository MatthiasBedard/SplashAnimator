<script lang="ts">
  import { intervalKeys } from '../../../packages/document/src/live-motion';
  import type { BasicMotionSpan } from '../../../packages/document/src';
  import type { MotionEase } from '../../../packages/document/src/motion-ease';
  import MotionEasing from './MotionEasing.svelte';

  let {span,axis,disabled,onchange,onapply}:{
    span: BasicMotionSpan;
    axis: 'x'|'y'|'opacity'|'rotation'|'sx'|'sy'|'shear'|'fill'|'stroke'|number;
    disabled: boolean;
    onchange: ()=>void;
    onapply: (frame:number,ease:MotionEase)=>void;
  }=$props();
  const stop=$derived(typeof axis==='number'?span.gradientColorTracks?.find(row=>row.stop===axis):undefined);
  const keys=$derived(typeof axis==='number'?stop?.keys:span[intervalKeys[`${axis}KeyEases`]]);
  const ends=$derived([...(keys??[]).map(key=>key.offset),span.end-span.start]);
  const timing=$derived(typeof axis==='number'?stop?.eases:span[`${axis}KeyEases`]);
  const label=$derived(typeof axis==='number'?'Gradient stop':axis==='sx'?'Horizontal scale':axis==='sy'?'Vertical scale':axis==='x'||axis==='y'?'Position':axis[0].toUpperCase()+axis.slice(1));
  let index=$state(0);
  let draft=$state<MotionEase|undefined>();
  const current=$derived(draft??timing?.[index]??'linear');
</script>

<label>Interval ending at
  <select bind:value={index} onchange={()=>{draft=undefined;onchange()}}>
    {#each ends as offset,i}<option value={i}>Frame {span.start+offset+1}</option>{/each}
  </select>
</label>
<MotionEasing label={label+' interval easing'} bind:value={()=>current,value=>{draft=value;onchange()}} />
<button {disabled} onclick={()=>onapply(span.start+ends[index],current)}>Apply {label.toLowerCase()} interval easing</button>
