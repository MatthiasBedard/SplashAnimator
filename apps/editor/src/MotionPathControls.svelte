<script lang="ts">
  import MotionPathPreview from './MotionPathPreview.svelte';
  import type { Point, Vector } from '../../../packages/document/src';
  import { curvedWaypointSegments, type MotionPath } from '../../../packages/animation/src/motion-path';
  import { alignMotionPathJoins } from './motion-path-align';
  let alignError = $state('');
  function alignJoins(matchLengths = false) {
    try {
      if(!value || !start || !end) throw new Error('Choose matching tween endpoints.');
      value=alignMotionPathJoins(start,end,value,matchLengths);alignError='';
    } catch(error) {alignError=error instanceof Error?error.message:'Join alignment failed.';}
  }
  import { motionPathFromGuide } from './motion-path-guide';
  let guideId=$state(''),guideError=$state('');
  import type { MotionRotation } from '../../../packages/animation/src/motion-rotation';
  let { groupSource = [], groupTarget = [], groupRotation, value = $bindable<MotionPath | undefined>(), label = 'Motion path', start, end, guides = [] }: {
    groupSource?: Vector[]; groupTarget?: Vector[]; groupRotation?: MotionRotation;
    value?: MotionPath; label?: string; start?: Point; end?: Point; guides?: Vector[];
  } = $props();
  const eligible=$derived(guides.filter(g=>!g.closed && (g.kind==='path'||g.kind==='bezier')));
  function useGuide() {
    try {
      const guide=eligible.find(g=>g.id===guideId);
      if(!guide || !value || !start || !end) throw new Error('Choose a guide and matching tween endpoints.');
      value=motionPathFromGuide(start,end,guide,value); guideError='';
    } catch(error) {guideError=error instanceof Error?error.message:'Guide could not be copied.';}
  }
  const automatic = $derived.by(() => {
    if(!start || !end || !value?.waypoints) return undefined;
    try {
      const segments=curvedWaypointSegments(start,end,value.waypoints);
      const last=segments[segments.length-1];
      return [...segments.map(([a,b])=>({x:b.x-a.x,y:b.y-a.y})),{x:last[3].x-last[2].x,y:last[3].y-last[2].y}];
    } catch {return undefined;}
  });
  function enabled(checked: boolean) {
    value = checked ? { startX: 0, startY: -100, endX: 0, endY: -100 } : undefined;
  }
  function control(key: 'startX' | 'startY' | 'endX' | 'endY', number: number) {
    if (value) value = { ...value, [key]: number };
  }
</script>

<label><input type="checkbox" aria-label={label} checked={!!value} onchange={(e) => enabled(e.currentTarget.checked)} />Position path</label>
{#if value}
  <fieldset>
    <legend>Path control offsets</legend>
    <small>Group paths show the leader reference route. A custom or saved group pivot adds its orbit correction to the generated artwork; the blue curve remains the reference route; the pink dashed overlay samples the corrected first group leader origin.</small>
    {#if eligible.length}
      <label>Stage guide<select aria-label={`${label} stage guide`} bind:value={guideId}><option value="">Choose open artwork path</option>{#each eligible as guide,index}<option value={guide.id}>{guide.kind==='bezier'?'Bezier':'Path'} {index+1}</option>{/each}</select></label>
      <button aria-label={`${label} use stage guide`} disabled={!start || !end || !guideId} onclick={useGuide}>Copy stage guide</button>
      <small>Copies visible open path artwork at the current frame, including its affine transform. Guide endpoints must match active tween origins within 0.000001 units. Other objects receive the same offsets. No live linkage; source artwork stays intact. Tangent rotation resets.</small>
    {/if}
    {#if guideError}<small role="alert">{guideError}</small>{/if}
    {#if start && end && [start.x, start.y, end.x, end.y, value.startX, value.startY, value.endX, value.endY].every(Number.isFinite) && (!value.waypoints || value.waypoints.every(p=>Number.isFinite(start!.x+p.x) && Number.isFinite(start!.y+p.y)))}
      <MotionPathPreview bind:value {start} {end} {label} {groupSource} {groupTarget} {groupRotation} />
    {/if}
    <label><input type="checkbox" aria-label={`${label} waypoint mode`} checked={!!value.waypoints} onchange={(e) => { if(value) value = {...value, curvedWaypoints:false, waypointIncoming:undefined,waypointTangents:undefined, waypoints:e.currentTarget.checked ? [{x:50,y:-50}] : undefined}; }} />Waypoint segments</label>
    {#if value.waypoints}
      <label><input type="checkbox" aria-label={`${label} curved waypoints`} checked={value.curvedWaypoints === true} onchange={(e)=>{if(value) value={...value,curvedWaypoints:e.currentTarget.checked,waypointIncoming:undefined,waypointTangents:undefined};}} />Curve through waypoints</label>
      {#if value.curvedWaypoints}
        <label><input type="checkbox" aria-label={`${label} custom curve handles`} checked={!!value.waypointTangents} disabled={!automatic} onchange={(e)=>{if(value && automatic) value={...value,waypointIncoming:undefined,waypointTangents:e.currentTarget.checked?automatic:undefined};}} />Custom curve handles</label>
        {#if value.waypointTangents}
          <label><input type="checkbox" aria-label={`${label} independent incoming handles`} checked={!!value.waypointIncoming} onchange={(e)=>{if(value?.waypointTangents) value={...value,waypointIncoming:e.currentTarget.checked?value.waypointTangents.slice(1,-1).map(p=>({x:-p.x,y:-p.y})):undefined};}} />Independent incoming waypoint handles</label>
          {#if value.waypointIncoming}
            <button aria-label={`${label} align tangent joins`} disabled={!start || !end} onclick={()=>alignJoins()}>Align joins for tangent rotation</button>
            <small>Rotates incoming handles opposite outgoing handles, keeping their lengths. Changes curve shape and enables tangent rotation only if the complete first-object path passes tangent and timing checks. Other objects are checked when generating.</small>
            <button aria-label={`${label} match tangent lengths`} disabled={!start || !end} onclick={()=>alignJoins(true)}>Match join directions and lengths</button>
            <small>Mirrors each outgoing handle into its incoming handle. Equal-time segments then have matching velocity at joins. Changes curve shape; retains timing and enables tangent rotation after preflight. Does not match curvature or lock later edits.</small>
            {#if alignError}<small role="alert">{alignError}</small>{/if}
            {#each value.waypointIncoming as handle,index}
              <div>{#each ['x','y'] as axis}
                <label>Incoming {index+1} {axis.toUpperCase()}<input type="number" aria-label={`${label} incoming ${index+1} ${axis}`} value={handle[axis as 'x'|'y']} oninput={(e)=>{if(value?.waypointIncoming) value={...value,waypointIncoming:value.waypointIncoming.map((p,i)=>i===index?{...p,[axis]:e.currentTarget.valueAsNumber}:p)};}} /></label>
              {/each}</div>
            {/each}
            <small>Incoming offsets are measured from each waypoint. Edit them independently to create corners. Tangent rotation rejects discontinuous directions at joins. Turning this off mirrors outgoing handles again.</small>
          {/if}
          {#each value.waypointTangents as handle, index}
            <div>{#each ['x','y'] as axis}
              <label>Curve handle {index+1} {axis.toUpperCase()}<input type="number" aria-label={`${label} curve handle ${index+1} ${axis}`} value={handle[axis as 'x'|'y']} oninput={(e)=>{if(value?.waypointTangents) value={...value,waypointTangents:value.waypointTangents.map((p,i)=>i===index?{...p,[axis]:e.currentTarget.valueAsNumber}:p)};}} /></label>
            {/each}</div>
          {/each}
          <small>Handles run from start through each waypoint to end. Values are outgoing offsets; incoming handles mirror them unless independent mode is enabled. The end preview shows its incoming handle. Turning this off restores automatic handles.</small>
        {/if}
      {/if}
      {#each value.waypoints as point, index}
        <div>
          {#each ['x','y'] as axis}
            <label>Waypoint {index+1} {axis.toUpperCase()}<input type="number" aria-label={`${label} waypoint ${index+1} ${axis}`} value={point[axis as 'x'|'y']} oninput={(e) => { if(value?.waypoints) value={...value,waypoints:value.waypoints.map((p,i)=>i===index?{...p,[axis]:e.currentTarget.valueAsNumber}:p)}; }} /></label>
          {/each}
          <button disabled={value.waypoints.length===1} aria-label={`${label} remove waypoint ${index+1}`} onclick={() => { if(value?.waypoints) value={...value,waypointIncoming:value.waypointIncoming?.filter((_,i)=>i!==index),waypointTangents:value.waypointTangents?.filter((_,i)=>i!==index+1),waypoints:value.waypoints.filter((_,i)=>i!==index)}; }}>Remove waypoint</button>
        </div>
      {/each}
      <button aria-label={`${label} add waypoint`} onclick={() => { if(value?.waypoints) value={...value,waypointIncoming:value.waypointIncoming?[...value.waypointIncoming,{...value.waypointIncoming[value.waypointIncoming.length-1]}]:undefined,waypointTangents:value.waypointTangents?[...value.waypointTangents.slice(0,-1),{...value.waypointTangents[value.waypointTangents.length-2]},{...value.waypointTangents[value.waypointTangents.length-1]}]:undefined,waypoints:[...value.waypoints,{...value.waypoints[value.waypoints.length-1]}]}; }}>Add waypoint</button>
      <small>Intermediate vertices are offsets from each object's start origin. Segments receive equal time unless Even distance is enabled. Straight segments: repeated vertices hold in equal-time mode and consume no distance in distance mode. Automatic and linked curves join smoothly; independent handles can create corners. Curves can overshoot or loop; repeated vertices do not hold. Even distance follows approximate travel length across the whole curved path. Tangent rotation is supported for curved paths with non-stationary travel throughout, including joins; straight paths use each segment heading and switch to the outgoing heading at corners. Straight tangent mode rejects repeated vertices and exact or numerically unresolved reversals; corners turn abruptly rather than smoothing. Endpoint keys stay exact: align authored endpoint rotations for seamless joins.</small>
    {:else}
    {#each [['startX', 'Start X'], ['startY', 'Start Y'], ['endX', 'End X'], ['endY', 'End Y']] as [key, name]}
      <label>{name}<input type="number" step="1" aria-label={`${label} ${name}`} value={value[key as 'startX' | 'startY' | 'endX' | 'endY']} oninput={(e) => control(key as 'startX' | 'startY' | 'endX' | 'endY', e.currentTarget.valueAsNumber)} /></label>
    {/each}
    {/if}
    <label><input type="checkbox" aria-label={`${label} even distance`} checked={value.distance === true} onchange={(e) => { if (value) value = { ...value, distance: e.currentTarget.checked }; }} />Even distance along path</label>
    <label><input type="checkbox" aria-label={`${label} tangent rotation`} checked={value.tangent === true} onchange={(e) => { if (value) value = { ...value, tangent: e.currentTarget.checked }; }} />Add path tangent rotation</label>
    {#if !value.waypoints}<small>Controls are offsets from each object's start/end origin in document units. Even distance uses approximate arc length; Linear easing gives approximately equal travel per frame. Other easing changes travel speed. With it off, easing follows the cubic parameter. Tangent rotation optionally adds the travel heading to each generated pose's rotation. Headings remain continuous across full turns. Authored rotations act as offsets. Endpoint keys stay exact: align their rotations yourself for seamless joins. Stationary or numerically unresolved interior tangents reject, including between frames. Stationary endpoint keys remain unchanged. Sharp near-reversals can still turn rapidly.</small>{/if}
  </fieldset>
{/if}
