<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MAX_VECTOR_POINTS, type Point, type Vector } from '../../../packages/document/src';
  import { curvedWaypointSegments, type MotionPath } from '../../../packages/animation/src/motion-path';
  import { motionGroupPreview } from './motion-group-preview';
  import type { MotionRotation } from '../../../packages/animation/src/motion-rotation';
  import type { Matrix } from '../../../packages/geometry/src/affine';
  let { groupSource = [], groupTarget = [], groupRotation, value = $bindable<MotionPath>(), start, end, label, stageBox, stageMatrix, stageScale = 1 }: {
    groupSource?: Vector[]; groupTarget?: Vector[]; groupRotation?: MotionRotation;
    value: MotionPath; start: Point; end: Point; label: string; stageBox?: {x:number;y:number;width:number;height:number};
    stageMatrix?: Matrix; stageScale?:number;
  } = $props();
  const orbit = $derived.by(() => {
    try { return { points: groupRotation ? motionGroupPreview(groupSource, groupTarget, groupRotation, value) : [], error: '' }; }
    catch(error) { return { points: [], error: error instanceof Error ? error.message : 'Group preview unavailable.' }; }
  });
  import { fitMotionWaypoints } from './motion-path-fit';
  let fitTolerance = $state(0.25);
  function fit() {
    try { const next=fitMotionWaypoints(start,end,value,fitTolerance); value=next; captureError=''; }
    catch(error) {captureError=error instanceof Error?error.message:'Path fitting failed. Previous settings kept.';}
  }
  let svg: SVGSVGElement;
  let drawingGroup: SVGGElement;
  const controls = $derived.by(() => {
    if(!value.waypoints) return [
      {x:start.x+value.startX,y:start.y+value.startY},
      {x:end.x+value.endX,y:end.y+value.endY},
    ];
    const vertices=value.waypoints.map(p=>({x:start.x+p.x,y:start.y+p.y}));
    const handles=value.waypointTangents?.map((p,i)=>{
      const vertex=i===0?start:i===vertices.length+1?end:vertices[i-1];
      const sign=i===vertices.length+1?-1:1;
      return {x:vertex.x+sign*p.x,y:vertex.y+sign*p.y};
    }) ?? [];
    for(const [i,p] of (value.waypointIncoming ?? []).entries()) handles.push({x:vertices[i].x+p.x,y:vertices[i].y+p.y});
    return [...vertices,...(handles.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))?handles:[])];
  });
  const curved = $derived.by(() => {
    if(!value.curvedWaypoints || !value.waypoints) return undefined;
    try { return curvedWaypointSegments(start,end,value.waypoints,value.waypointTangents,value.waypointIncoming); } catch { return undefined; }
  });
  const fitted = $derived.by(() => {
    const points = [start, end, ...controls, ...(curved?.flat() ?? []), ...orbit.points];
    let left=start.x, top=start.y, right=start.x, bottom=start.y;
    for(const point of points) {left=Math.min(left,point.x);top=Math.min(top,point.y);right=Math.max(right,point.x);bottom=Math.max(bottom,point.y);}
    const width=Math.max(100,right-left),height=Math.max(100,bottom-top);
    const pad = Math.max(width, height) * 0.15;
    return { x: left - pad, y: top - pad, width: width + pad * 2, height: height + pad * 2 };
  });
  let drag = $state<{ index: number; pointer: number; before: MotionPath; grab: Point; transform: number[]; box: typeof fitted }>();
  let drawing = $state(false);
  let capture = $state<{pointer:number; points:Point[]; transform:number[]; box:typeof fitted}>();
  let captureError = $state('');
  const box = $derived(capture?.box ?? drag?.box ?? stageBox ?? fitted);
  onDestroy(()=>{if(drag) value=drag.before;});
  function cancelCapture() {
    const id=capture?.pointer;
    capture=undefined; drawing=false;
    if(id!==undefined && svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
  }
  function capturePoint(event:PointerEvent) {
    if(!capture || event.pointerId!==capture.pointer) return;
    if (!sameTransform(capture.transform)) {
      captureError='View changed during capture. Previous settings kept.';
      cancelCapture(); return;
    }
    const point=pointer(event);
    if(!point || !Number.isFinite(point.x-start.x) || !Number.isFinite(point.y-start.y)) {
      captureError='Path capture contains unresolved coordinates. Previous settings kept.';
      cancelCapture(); return;
    }
    const last=capture.points[capture.points.length-1];
    if(last && last.x===point.x && last.y===point.y) return;
    if(capture.points.length>=MAX_VECTOR_POINTS-2) {
      captureError='Path capture exceeds the vector point limit. Previous settings kept.';
      cancelCapture(); return;
    }
    capture.points.push({x:point.x,y:point.y});
  }
  function captureDown(event:PointerEvent) {
    if(!drawing || capture || event.button!==0) return;
    event.preventDefault(); event.stopPropagation(); svg.focus();
    capture={pointer:event.pointerId,points:[],transform:screenTransform(),box:{...box}};
    svg.setPointerCapture(event.pointerId); capturePoint(event);
  }
  function captureUp(event:PointerEvent) {
    if(!capture || event.pointerId!==capture.pointer) return;
    capturePoint(event);
    if(!capture) return;
    if(capture.points.length>=2) value={...value,
      waypoints:capture.points.map(p=>({x:p.x-start.x,y:p.y-start.y})),
      curvedWaypoints:false,waypointTangents:undefined,waypointIncoming:undefined,tangent:false};
    else captureError='Draw at least two distinct points. Previous settings kept.';
    cancelCapture();
  }
  function shift(index: number, delta: Point, before = value) {
    if(before.waypoints && before.waypointTangents && before.waypointIncoming && index>=before.waypoints.length+before.waypointTangents.length) {
      const i=index-before.waypoints.length-before.waypointTangents.length;
      const point={x:before.waypointIncoming[i].x+delta.x,y:before.waypointIncoming[i].y+delta.y};
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)) return;
      value={...value,waypointIncoming:before.waypointIncoming.map((p,j)=>i===j?point:p)};
      return;
    }
    if(before.waypoints && before.waypointTangents && index>=before.waypoints.length) {
      const i=index-before.waypoints.length, sign=i===before.waypointTangents.length-1?-1:1;
      const point={x:before.waypointTangents[i].x+sign*delta.x,y:before.waypointTangents[i].y+sign*delta.y};
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)) return;
      value={...value,waypointTangents:before.waypointTangents.map((p,j)=>i===j?point:p)};
      return;
    }
    if(before.waypoints) {
      const point={x:before.waypoints[index].x+delta.x,y:before.waypoints[index].y+delta.y};
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)) return;
      value={...value,waypoints:before.waypoints.map((p,i)=>i===index?point:p)};
      return;
    }
    const x = (index === 0 ? before.startX : before.endX) + delta.x;
    const y = (index === 0 ? before.startY : before.endY) + delta.y;
    if (![x, y].every(Number.isFinite)) return;
    value = index === 0
      ? { ...value, startX: x, startY: y }
      : { ...value, endX: x, endY: y };
  }
  function screenTransform(): number[] {
    const m=drawingGroup.getScreenCTM();
    return m ? [m.a,m.b,m.c,m.d,m.e,m.f,...(stageBox ? [stageBox.x,stageBox.y,stageBox.width,stageBox.height] : [])] : [];
  }
  function sameTransform(before:number[]): boolean {
    const now=screenTransform();
    return before.length>=6 && now.length===before.length && now.every((v,i)=>Number.isFinite(v) && v===before[i]);
  }
  function pointer(event: PointerEvent): Point | undefined {
    const matrix = drawingGroup.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y].every(Number.isFinite) ? point : undefined;
  }
  function down(event: PointerEvent, index: number) {
    if (drawing || event.button !== 0 || drag) return;
    const grab = pointer(event);
    if (!grab) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as SVGCircleElement).focus();
    drag = { index, pointer: event.pointerId, before: { ...value }, grab, transform:screenTransform(), box: { ...box } };
    svg.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (!sameTransform(drag.transform)) { finish(true); return; }
    const point = pointer(event);
    if (!point) { finish(true); return; }
    shift(drag.index, { x: point.x - drag.grab.x, y: point.y - drag.grab.y }, drag.before);
  }
  function finish(cancel: boolean) {
    if (!drag) return;
    const previous = drag;
    drag = undefined;
    if (cancel) value = previous.before;
    if (svg.hasPointerCapture(previous.pointer)) svg.releasePointerCapture(previous.pointer);
  }
  function key(event: KeyboardEvent, index: number) {
    if(drawing) {
      if(event.key==='Escape') {event.preventDefault();event.stopPropagation();cancelCapture();}
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(true); return; }
    if (drag) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    if (!delta[event.key]) return;
    event.preventDefault(); event.stopPropagation();
    shift(index, delta[event.key]);
  }
</script>

<svelte:window onkeydown={(e)=>{if(e.key==='Escape' && drawing){e.preventDefault();e.stopPropagation();cancelCapture();}}} />
<div class:stage-tools={!!stageBox}>
<button aria-label={`${label} draw freehand`} disabled={!!drag} onclick={()=>{if(drawing) cancelCapture(); else {captureError='';drawing=true;}}}>{drawing?'Cancel freehand capture':'Draw freehand waypoints'}</button>
{#if stageBox && drawing}<small>Draw intermediate waypoints. Endpoints stay fixed; release accepts, Escape cancels.</small>{/if}
{#if captureError}<small role="alert">{captureError}</small>{/if}
</div>
{#if !stageBox}
{#if value.waypoints && !value.curvedWaypoints}
  <label>Fit tolerance<input type="number" min="0" step="0.05" aria-label={`${label} fit tolerance`} bind:value={fitTolerance} /></label>
  <button aria-label={`${label} fit curves`} disabled={drawing || !!drag} onclick={fit}>Fit waypoint curves</button>
  <small>Fits the complete polyline, including authored endpoints, in document units. Keeps sharp corners; tangent rotation resets. Existing fitter limits: 8192 input points and bounded work. Failure keeps your path. Fitting can change equal-segment timing; Even distance follows travel length.</small>
{/if}
{/if}
<svg class:stage-overlay={!!stageBox} preserveAspectRatio={stageBox?'none':'xMidYMid meet'} role="group" tabindex="-1" bind:this={svg} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} aria-label={`${label} preview`}
  onpointerdown={captureDown}
  onpointermove={(e)=>{if(capture) capturePoint(e); else move(e);}}
  onpointerup={(e) => { if(capture) captureUp(e); else if (e.pointerId === drag?.pointer) { move(e); finish(false); } }}
  onpointercancel={() => {cancelCapture();finish(true);}} onlostpointercapture={() => {cancelCapture();finish(true);}}>
  <title>{label} preview for first endpoint artwork</title>
  <g bind:this={drawingGroup} transform={stageMatrix ? `matrix(${stageMatrix.join(' ')})` : undefined}>
  {#if value.waypoints}
    {#if curved}
    <path d={`M ${start.x} ${start.y} ${curved.map(([,a,b,c])=>`C ${a.x} ${a.y} ${b.x} ${b.y} ${c.x} ${c.y}`).join(' ')}`} class="curve" />
    {:else if !value.curvedWaypoints}
    <path d={`M ${start.x} ${start.y} ${controls.map(p=>`L ${p.x} ${p.y}`).join(' ')} L ${end.x} ${end.y}`} class="curve" />
    {/if}
  {:else}
  <path d={`M ${start.x} ${start.y} L ${controls[0].x} ${controls[0].y} M ${end.x} ${end.y} L ${controls[1].x} ${controls[1].y}`} class="guides" />
  <path d={`M ${start.x} ${start.y} C ${controls[0].x} ${controls[0].y} ${controls[1].x} ${controls[1].y} ${end.x} ${end.y}`} class="curve" />
  {/if}
  {#if orbit.points.length}
    <path aria-label={`${label} group leader orbit`} d={orbit.points.map((p,i)=>`${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')} class="orbit" />
  {/if}
  {#if capture && capture.points.length}
    <path d={`M ${start.x} ${start.y} ${capture.points.map(p=>`L ${p.x} ${p.y}`).join(' ')} L ${end.x} ${end.y}`} class="capture" />
  {/if}
  {#each [start, end] as point}
    <circle cx={point.x} cy={point.y} r={stageBox?3/stageScale:Math.max(box.width, box.height) * 0.012} class="endpoint" />
  {/each}
  {#if value.waypoints && value.waypointTangents}
    {#each controls.slice(value.waypoints.length) as handle, index}
      {@const vertex=index>=value.waypointTangents.length?controls[index-value.waypointTangents.length]:index===0?start:index===value.waypoints.length+1?end:controls[index-1]}
      <path d={`M ${vertex.x} ${vertex.y} L ${handle.x} ${handle.y}`} class="guides" />
    {/each}
  {/if}
  {#each controls as point, index}
    <circle cx={point.x} cy={point.y} r={stageBox?6/stageScale:Math.max(box.width, box.height) * 0.025}
      role="button" tabindex="0" aria-label={`${label} ${value.waypoints ? (index < value.waypoints.length ? `waypoint ${index+1}` : index>=value.waypoints.length+(value.waypointTangents?.length ?? 0)?`incoming ${index-value.waypoints.length-(value.waypointTangents?.length ?? 0)+1}`:`curve handle ${index-value.waypoints.length+1}`) : index === 0 ? 'start' : 'end'} handle`}
      onpointerdown={(e) => down(e, index)} onkeydown={(e) => key(e, index)} class="handle" />
  {/each}
  </g>
</svg>
{#if !stageBox}<small>Freehand capture replaces intermediate waypoints with sampled straight segments and disables tangent rotation/custom handles. Start and end stay authored; release commits settings, Escape cancels. Sampling follows pointer events, without smoothing. Preview follows the first artwork object on the active track. Drag handles or use arrow keys (Shift: 10 units); Escape cancels a drag. Offsets also apply to other generated objects.</small>{/if}

{#if !stageBox && orbit.points.length}<small>Pink dashed line: sampled first group leader origin after pivot corrections. Blue: editable reference route. Samples use uniform progress, not key timing. Other groups and artwork bounds are not shown; generation still validates the full operation.</small>{/if}
{#if !stageBox && orbit.error}<small role="status">{orbit.error} Artwork and settings are unchanged.</small>{/if}

<style>
  svg { width: 100%; height: 160px; background: #18202b; border: 1px solid #65738a; touch-action: none; }
  .stage-tools {position:absolute;bottom:4px;right:4px;z-index:1;max-width:calc(100% - 8px);background:#18202b;color:white;}
  .stage-tools small {display:block;padding:4px;}
  svg.stage-overlay { position:absolute; inset:0; width:100%; height:100%; background:transparent; border:0; }
  path { fill: none; vector-effect: non-scaling-stroke; }
  .guides { stroke: #8693a8; stroke-dasharray: 4 3; }
  .capture { stroke: #ffd166; stroke-width: 2; }
  .orbit { stroke: #ff91d0; stroke-width: 2; stroke-dasharray: 5 3; pointer-events: none; }
  .curve { stroke: #6bc9ff; stroke-width: 2; }
  .endpoint { fill: #fff; }
  .handle { fill: #ffd166; stroke: #18202b; stroke-width: 1; vector-effect: non-scaling-stroke; cursor: grab; }
  .handle:focus { stroke: #fff; stroke-width: 3; outline: none; }
</style>
