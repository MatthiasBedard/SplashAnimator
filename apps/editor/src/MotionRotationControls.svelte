<script lang="ts">
  import type { MotionRotation } from '../../../packages/animation/src/motion-rotation';
  let { value = $bindable<MotionRotation>({ direction: 'shortest', turns: 0 }), label = 'Motion rotation' }: {
    value?: MotionRotation; label?: string;
  } = $props();
</script>

<label>Rotation<select aria-label={label} value={value.direction} onchange={(e) => {
  const direction = e.currentTarget.value as MotionRotation['direction'];
  value = { ...value, direction, turns: direction === 'shortest' ? 0 : value.turns };
}}>
  <option value="shortest">Shortest</option>
  <option value="clockwise">Clockwise</option>
  <option value="counterclockwise">Counterclockwise</option>
</select></label>
{#if value.direction !== 'shortest'}
  <label>Extra full turns<input type="number" min="0" step="1" aria-label={`${label} extra turns`} value={value.turns} oninput={(e) => value = { ...value, turns: e.currentTarget.valueAsNumber }} /></label>
  <small>Adds full turns to the chosen direction between endpoint poses. Easing controls rotation progress; endpoint keys stay unchanged.</small>
{/if}

<label><input type="checkbox" aria-label={`${label} rigid groups`} checked={value.rigidGroups===true} onchange={(e)=>value={...value,rigidGroups:e.currentTarget.checked,groupDepth:e.currentTarget.checked?value.groupDepth:undefined,savedGroupPivots:e.currentTarget.checked?value.savedGroupPivots:undefined,uniformGroupScale:e.currentTarget.checked?value.uniformGroupScale:undefined,axisGroupScale:e.currentTarget.checked?value.axisGroupScale:undefined,axisGroupShear:e.currentTarget.checked?value.axisGroupShear:undefined,rigidPivot:e.currentTarget.checked?value.rigidPivot:undefined}} />{(value.groupDepth ?? 0) > 0 ? 'Move nested groups rigidly' : 'Move outer groups rigidly'}</label>
<small>Each group at the chosen nesting level rotates around its first artwork member and shares that member's path. Endpoint offsets and rotation must agree; node and primitive interpolation must be off. Scale/skew must be off unless group scaling is enabled. Artwork without a multi-member group at that level moves independently. Authored endpoint keys stay exact.</small>

{#if value.rigidGroups}
  <small>With Position path, the preview shows the first member's reference route before pivot orbit corrections. The pivot follows that route plus its interpolated source/target offset. Tangent rotation also rotates the group around the moving pivot; authored endpoint rotations stay exact.</small>
  <label>Group nesting level<input type="number" min="0" step="1" aria-label={`${label} group nesting level`} value={value.groupDepth ?? 0} oninput={(e)=>value={...value,groupDepth:e.currentTarget.valueAsNumber}} /></label>
  <small>Zero moves outer groups together. One moves their immediate subgroups independently; higher levels select deeper groups. Parent motion is not added. Every selected track needs a group with at least two members at that level.</small>
  <label><input type="checkbox" aria-label={`${label} uniform group scale`} checked={value.uniformGroupScale===true} onchange={(e)=>value={...value,uniformGroupScale:e.currentTarget.checked,axisGroupScale:e.currentTarget.checked?undefined:value.axisGroupScale,axisGroupShear:e.currentTarget.checked?undefined:value.axisGroupShear}} />Scale groups uniformly</label>
  <small>Enable Interpolate scale and skew too. Each group requires one positive scale ratio for all member bases and offsets. Local skew and reflection stay unchanged; spacing scales with artwork.</small>
  <label><input type="checkbox" aria-label={`${label} axis group scale`} checked={value.axisGroupScale===true} onchange={(e)=>value={...value,axisGroupScale:e.currentTarget.checked,axisGroupShear:e.currentTarget.checked?value.axisGroupShear:undefined,uniformGroupScale:e.currentTarget.checked?undefined:value.uniformGroupScale}} />Scale group X and Y independently</label>
  <small>Enable Interpolate scale and skew too. Without combined shear, positive X/Y ratios apply in source document axes before shared rotation, scaling spacing and artwork together. Every member endpoint must agree. Custom and saved pivots follow the scaled endpoint offset. Local bases may gain skew.</small>
  {#if value.axisGroupScale}
    <label><input type="checkbox" aria-label={`${label} group shear`} checked={value.axisGroupShear===true} onchange={(e)=>value={...value,axisGroupShear:e.currentTarget.checked}} />Shear group axes</label>
    <small>Shared X/Y shear in source document axes is interpolated before rotation. Combined shear permits zero or negative diagonal coefficients when the entire interpolation preserves orientation. Every member basis and offset must agree. Custom and saved pivots follow their sheared endpoint offsets. Endpoint bases choose the shear. Combined axes must preserve orientation without collapse throughout the span; every member shares the same transform.</small>
  {/if}
  <label><input type="checkbox" aria-label={`${label} custom rigid pivot`} checked={!!value.rigidPivot} onchange={(e)=>value={...value,rigidPivot:e.currentTarget.checked?{x:0,y:0}:undefined,savedGroupPivots:e.currentTarget.checked?undefined:value.savedGroupPivots}} />Custom rigid pivot</label>
  <label><input type="checkbox" aria-label={`${label} saved group pivots`} checked={value.savedGroupPivots===true} onchange={(e)=>value={...value,savedGroupPivots:e.currentTarget.checked,rigidPivot:e.currentTarget.checked?undefined:value.rigidPivot}} />Use group leaders' saved pivots</label>
  <small>Each selected group uses its first member's saved artwork pivot, transformed from local to document coordinates. Every group leader needs a saved pivot. Other members' pivots do not choose the group center. Endpoint artwork stays exact.</small>
  {#if value.rigidPivot}
    {#each ['x','y'] as axis}
      <label>Pivot offset {axis.toUpperCase()}<input type="number" aria-label={`${label} rigid pivot ${axis}`} value={value.rigidPivot[axis as 'x'|'y']} oninput={(e)=>{if(value.rigidPivot)value={...value,rigidPivot:{...value.rigidPivot,[axis]:e.currentTarget.valueAsNumber}};}} /></label>
    {/each}
    <small>Document-space offset from each group's first member at the start. The pivot travels linearly to its rotated and optionally scaled endpoint offset; easing controls progress. Position paths bend this translation route. Endpoint artwork stays exact.</small>
  {/if}
{/if}
