<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { keyAt, type Project, type MotionSpanOptions } from '../../../packages/document/src';
  import type { MotionEase } from '../../../packages/document/src/motion-ease';
  import type { MotionPath } from '../../../packages/document/src/motion-path';
  import { supportsPlacementChannel, validateLiveMotionData, liveNumericChannels, liveColorChannels, hasKeyableSolidFill } from '../../../packages/document/src/live-motion';
  import { liveGroupHeaderChange, type LiveGroupHeaderPatch } from './live-group-edit';
  import type { UpdateLiveMotionRequest } from '../../../packages/animation/src/live-motion';
  import { liveGradientEndpoints } from '../../../packages/animation/src/motion-frames';
  import MotionEasing from './MotionEasing.svelte';
  import {
    independentGroupBankChange,
    type IndependentCubicPoints,
  } from '../../../packages/animation/src/independent-group-bank-edit';
  let {
    snapshot,
    at,
    track,
    apply,
  }: {
    snapshot: Project;
    at: number;
    track: string;
    apply: (
      requests: readonly UpdateLiveMotionRequest[],
      validate: () => void,
      includeNested?: boolean,
    ) => void;
  } = $props();
  const original = untrack(() => ({ snapshot, at, track, apply }));
  const records = original.snapshot.layers.flatMap((layer) =>
    (layer.liveMotionSpans ?? []).map((span) => ({
      layerId: layer.id,
      spanId: span.id,
      name: layer.name,
      span,
      available:
        layer.visible &&
        !layer.locked &&
        (span.symbolContinuity === undefined ||
          ['graphics', 'movies', 'movie-trees'].includes(span.symbolContinuity)),
      symbolic: span.symbolContinuity === 'graphics',
      movie: span.symbolContinuity === 'movies',
      nested: span.symbolContinuity === 'movie-trees',
      grouped: span.rotation?.rigidGroups === true,
      enabled:
        layer.visible &&
        !layer.locked &&
        span.rotation?.rigidGroups !== true &&
        span.symbolContinuity === undefined,
    })),
  );
  const initial =
    records.find(
      (r) =>
        r.enabled &&
        r.layerId === original.track &&
        r.span.start <= original.at &&
        r.span.end >= original.at,
    ) ??
    records.find((r) => r.enabled && r.layerId === original.track) ??
    records.find((r) => r.enabled);
  let chosen = $state<number[]>(initial ? [records.indexOf(initial)] : []),
    changeEase = $state(false),
    clearOptions = $state(false);
  let ease = $state<MotionEase>(
    initial
      ? typeof initial.span.ease === 'object'
        ? { ...initial.span.ease }
        : initial.span.ease
      : 'linear',
  );
  type ChannelMode = 'keep' | 'set' | 'inherit';
  const copyEase = (value: MotionEase): MotionEase =>
    typeof value === 'object' ? { ...value } : value;
  let opacityMode = $state<ChannelMode>('keep'),
    paintMode = $state<ChannelMode>('keep');
  let opacityEase = $state<MotionEase>(
      copyEase(initial?.span.opacityEase ?? initial?.span.ease ?? 'linear'),
    ),
    paintEase = $state<MotionEase>(
      copyEase(initial?.span.paintEase ?? initial?.span.ease ?? 'linear'),
    );
  function channelReadout(value: MotionEase | undefined) {
    return value === undefined
      ? 'Inherit geometry'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  }
  type PathMode = 'keep' | 'replace' | 'remove' | 'guide';
  const savedGuide = initial?.span.guide;
  const guides = original.snapshot.layers.flatMap(layer => {
    const key = keyAt(layer, original.at);
    return key?.shapes.flatMap((shape, index) => !shape.closed && ['path','bezier'].includes(shape.kind)
      ? [{ binding: { layerId: layer.id, frame: key.frame, shapeId: shape.id },
           name: `${layer.name} · ${shape.kind} ${index + 1} · frame ${key.frame + 1}` }]
      : []) ?? [];
  });
  let guideIndex = $state(guides.findIndex(({binding}) => binding.layerId === savedGuide?.layerId &&
    binding.frame === savedGuide.frame && binding.shapeId === savedGuide.shapeId)),
    guideOffsetX = $state(savedGuide?.offset?.x ?? 0),
    guideOffsetY = $state(savedGuide?.offset?.y ?? 0),
    guideTangent = $state(savedGuide?.tangent === true);
  const initialCubic = initial?.span.path?.waypoints ? undefined : initial?.span.path;
  let pathMode = $state<PathMode>('keep'),
    pathControls = $state({
      startX: initialCubic?.startX ?? 0,
      startY: initialCubic?.startY ?? 0,
      endX: initialCubic?.endX ?? 0,
      endY: initialCubic?.endY ?? 0,
    }),
    pathDistance = $state(initialCubic?.distance === true),
    pathTangent = $state(initialCubic?.tangent === true);
  const controlFields = ['startX', 'startY', 'endX', 'endY'] as const;
  function pathReadout(path: MotionPath | undefined) {
    if (!path) return 'Straight interpolation (no path)';
    const kind = path.waypoints
      ? `${path.curvedWaypoints ? 'Curved' : 'Straight'} waypoint route (${path.waypoints.length} waypoints)`
      : 'Single cubic';
    return `${kind}; ${path.distance ? 'distance' : 'parameter'} timing${path.tangent ? '; tangent heading' : ''}${path.waypointTangents ? '; custom handles' : ''}${path.headingOffset !== undefined ? '; saved heading correction' : ''}`;
  }
  const bankChoices = records.flatMap((r, index) => {
    if (!r.grouped) return [];
    const layer = original.snapshot.layers.find((l) => l.id === r.layerId)!,
      first = layer.keys.find((k) => k.frame === r.span.start)!.shapes,
      last = layer.keys.find((k) => k.frame === r.span.end)!.shapes;
    const firstByGroup = new SvelteMap<string, (typeof first)[number]>();
    for (const shape of first) {
      const group = shape.groups?.[0];
      if (group && !firstByGroup.has(group)) firstByGroup.set(group, shape);
    }
    const lastById = new SvelteMap(last.map((shape) => [shape.id, shape]));
    const groups = new Set([
      ...first.flatMap((s) => (s.groups?.[0] ? [s.groups[0]] : [])),
      ...(r.span.groupPaths ?? []).map((b) => b.groupId),
    ]);
    return [...groups].map((groupId) => ({
      key: JSON.stringify([index, groupId]),
      index,
      groupId,
      record: r,
      first: firstByGroup.get(groupId),
      last: lastById.get(firstByGroup.get(groupId)?.id ?? ''),
    }));
  });
  let bankMode = $state<'keep' | 'set' | 'remove' | 'timing'>('keep'),
    bankPick = $state(''),
    bankEase = $state<MotionEase>('linear'),
    bankPoints = $state<IndependentCubicPoints>({ startX: NaN, startY: NaN, endX: NaN, endY: NaN });
  function chooseBank(key: string) {
    bankPick = key;
    const c = bankChoices.find((c) => c.key === key),
      a = c?.first,
      b = c?.last,
      old = c?.record.span.groupPaths?.find((row) => row.groupId === c.groupId)?.path;
    bankEase = copyEase(c?.record.span.groupPaths?.find(row => row.groupId === c.groupId)?.ease ?? 'linear');
    if (a && b) {
      const dx = b.x - a.x,
        dy = b.y - a.y;
      bankPoints = {
        startX: a.x + (old?.startX ?? dx / 3),
        startY: a.y + (old?.startY ?? dy / 3),
        endX: b.x + (old?.endX ?? -dx / 3),
        endY: b.y + (old?.endY ?? -dy / 3),
      };
    } else bankPoints = { startX: NaN, startY: NaN, endX: NaN, endY: NaN };
    change();
  }
  type OptionMode = 'keep' | 'enable' | 'disable' | 'remove';
  let modes = $state<Record<string, OptionMode>>({}),
    message = $state('Choose only the settings you want to change.'),
    saving = $state(false);
  let revision = 0,
    alive = true;
  const fields: readonly [Exclude<keyof MotionSpanOptions, 'gradientStops'>, string][] = [
    ['affine', 'Scale and skew'],
    ['paint', 'Paint colors'],
    ['nodes', 'Matching path nodes'],
    ['primitives', 'Primitive geometry'],
    ['strokeWidth', 'Stroke width'],
    ['strokeColor', 'Stroke color (geometry timing)'],
    ['pivots', 'Pivot interpolation'],
    ['defaultPivots', 'Authoring-box default pivots'],
    ['gradientGeometry', 'Gradient geometry'],
    ['gradientBasis', 'Gradient basis'],
    ['gradientPremultiplied', 'Opacity-weighted gradient colors'],
    ['contourAreas', 'Reject contour area collapse'],
    ['contourEdges', 'Reject collapsed edges'],
    ['contourContacts', 'Reject contour contacts'],
    ['curveTangents', 'Reject stationary or reversing curve tangents'],
    ['curveSelfContacts', 'Reject single-curve self contacts'],
  ];
  let includeGraphics = $state(false);
  let includeMovies = $state(false);
  let includeNested = $state(false);
  let includeGroups = $state(false),
    groupDirection = $state<'keep' | 'shortest' | 'clockwise' | 'counterclockwise'>('keep'),
    groupTurnsMode = $state<'keep' | 'set'>('keep'),
    groupTurns = $state(0),
    groupModes = $state<Record<string, OptionMode>>({});
  const groupFields = [
    ['uniformGroupScale', 'Uniform scaling'],
    ['axisGroupScale', 'Independent axis scaling'],
    ['axisGroupShear', 'Shared shear'],
  ] as const;
  const groupChanged = $derived(
    includeGroups &&
      (groupDirection !== 'keep' ||
        groupTurnsMode !== 'keep' ||
        Object.values(groupModes).some((v) => v !== 'keep')),
  );
  function eligible(record: (typeof records)[number] | undefined) {
    return (
      !!record?.available &&
      (!record.symbolic || includeGraphics) &&
      (!record.movie || includeMovies) &&
      (!record.nested || includeNested) &&
      (!record.grouped || includeGroups)
    );
  }
  const colorRecord = $derived.by(() => {
    if (chosen.length !== 1) return undefined;
    const record = records[chosen[0]];
    if (!record?.enabled && !((record?.symbolic || record?.movie || record?.nested) && eligible(record))) return undefined;
    const layer = original.snapshot.layers.find(layer=>layer.id===record.layerId);
    const shapes = layer?.keys.find(key=>key.frame===record.span.start)?.shapes;
    return shapes?.length === 1 && !shapes[0].groups?.length ? record : undefined;
  });
  const canKeyFill = $derived.by(() => {
    if (!colorRecord) return false;
    const {layerId, span} = colorRecord;
    const layer = original.snapshot.layers.find(layer => layer.id === layerId);
    return [span.start,span.end].every(frame => {
      const shape = layer?.keys.find(key => key.frame === frame)?.shapes[0];
      return shape && hasKeyableSolidFill(shape);
    });
  });
  const colorDraft = () => ({action:'keep' as 'keep'|'set'|'delete'|'clear', owner:-1, frame:original.at+1, value:'#000000'});
  let colorDrafts = $state({stroke:colorDraft(),fill:colorDraft()});
  const gradientStops=$derived.by(()=>{
    if (!colorRecord || colorRecord.symbolic || colorRecord.movie || colorRecord.nested) return [];
    const {span,layerId}=colorRecord;
    const layer=original.snapshot.layers.find(layer=>layer.id===layerId)!;
    const a=layer.keys.find(k=>k.frame===span.start)?.shapes[0], b=layer.keys.find(k=>k.frame===span.end)?.shapes[0];
    return a && b ? liveGradientEndpoints(a,b,span.options)?.first ?? [] : [];
  });
  let gradientStop=$state(0), gradientDraft=$state(colorDraft());
  const timingDraft=()=>({offset:-1,owner:-1,ease:'linear' as MotionEase});
  function editedTiming(existing:readonly {offset:number}[],keys:readonly {offset:number}[],length:number,
    saved:readonly MotionEase[]|undefined,draft:ReturnType<typeof timingDraft>) {
    const oldEnds=[...existing.map(k=>k.offset),length];
    const byEnd=new Map(oldEnds.map((offset,index)=>[offset,saved?.[index]??'linear']));
    const ends=[...keys.map(k=>k.offset),length];
    if(draft.offset>=0 && !ends.includes(draft.offset))throw Error('The selected timing interval no longer exists.');
    const timing=ends.map(offset=>offset===draft.offset?copyEase(draft.ease):byEnd.get(offset)??'linear');
    return timing.some(e=>e!=='linear') ? timing : undefined;
  }
  let gradientTiming=$state(timingDraft());
  let intervalTiming=$state({sx:timingDraft(),sy:timingDraft(),shear:timingDraft(),x:timingDraft(),y:timingDraft(),opacity:timingDraft(),rotation:timingDraft(),fill:timingDraft(),stroke:timingDraft()});
  const numericDraft = () => ({...colorDraft(), value:NaN});
  let numericDrafts = $state({x:numericDraft(),y:numericDraft(),opacity:numericDraft(),sx:numericDraft(),sy:numericDraft(),shear:numericDraft(),rotation:numericDraft()});
  const changed = $derived(
    Object.values(intervalTiming).some(draft=>draft.offset>=0) || gradientTiming.offset>=0 || gradientDraft.action !== 'keep' || liveNumericChannels.some(({property}) => numericDrafts[property].action !== 'keep') ||
    liveColorChannels.some(({property}) => colorDrafts[property].action !== 'keep') ||
    bankMode !== 'keep' ||
      groupChanged ||
      changeEase ||
      clearOptions ||
      opacityMode !== 'keep' ||
      paintMode !== 'keep' ||
      pathMode !== 'keep' ||
      Object.values(modes).some((v) => v !== 'keep'),
  );
  function change() {
    revision++;
    message = 'Ready to apply. Unchanged settings remain specific to each recipe.';
  }
  function save() {
    if (saving) return;
    saving = true;
    try {
      const owned = revision,
        nestedScope = includeNested,
        stamp = JSON.stringify([
          colorDrafts, numericDrafts, intervalTiming, gradientTiming, gradientStop, gradientDraft,
          chosen,
          changeEase,
          ease,
          clearOptions,
          modes,
          opacityMode,
          opacityEase,
          paintMode,
          paintEase,
          pathMode,
          pathControls, guideIndex, guideOffsetX, guideOffsetY, guideTangent,
          pathDistance,
          pathTangent,
          includeGroups,
          includeGraphics,
          includeMovies,
          includeNested,
          groupDirection,
          groupTurnsMode,
          groupTurns,
          groupModes,
          bankMode,
          bankPick,
          bankPoints,
          bankEase,
        ]);
      if (![opacityMode, paintMode].every((mode) => ['keep', 'set', 'inherit'].includes(mode)))
        throw Error('Choose an explicit independent channel mode.');
      if (!['keep', 'replace', 'remove', 'guide'].includes(pathMode))
        throw Error('Choose an explicit live trajectory mode.');
      if (
        !Object.values(modes).every((mode) =>
          ['keep', 'enable', 'disable', 'remove'].includes(mode),
        )
      )
        throw Error('Choose explicit live interpolation option modes.');
      if (
        !['keep', 'shortest', 'clockwise', 'counterclockwise'].includes(groupDirection) ||
        !['keep', 'set'].includes(groupTurnsMode)
      )
        throw Error('Choose explicit group rotation settings.');
      const bankChoice = bankChoices.find((c) => c.key === bankPick);
      if (
        bankMode !== 'keep' &&
        (!includeGroups || chosen.length !== 1 || !bankChoice || bankChoice.index !== chosen[0])
      )
        throw Error('Select exactly the original recipe matching the independent group route.');
      if (!['keep', 'set', 'remove', 'timing'].includes(bankMode))
        throw Error('Choose an explicit independent group route action.');
      const requests: UpdateLiveMotionRequest[] = chosen.map((i) => {
        const r = records[i],
          changes: UpdateLiveMotionRequest['changes'] = {};
        if (!eligible(r))
          throw Error(
            'Choose original visible unlocked records and explicitly include their motion mode.',
          );
        if (r.grouped && groupChanged) {
          validateLiveMotionData(r.span);
          const patch: LiveGroupHeaderPatch = {
            ...(groupDirection === 'keep' ? {} : { direction: groupDirection }),
            ...(groupTurnsMode === 'keep' ? {} : { turns: groupTurns }),
          };
          for (const [key] of groupFields) {
            const mode = groupModes[key] ?? 'keep';
            if (mode !== 'keep') patch[key] = mode as Exclude<OptionMode, 'keep'>;
          }
          changes.rotation = liveGroupHeaderChange(r.span.rotation!, patch);
        }
        if (bankMode !== 'keep')
          changes.groupPaths = independentGroupBankChange(
            original.snapshot,
            r.layerId,
            r.spanId,
            bankChoice!.groupId,
            bankMode,
            bankMode === 'set' ? { ...bankPoints } : undefined,
            bankMode === 'set' || bankMode === 'timing' ? copyEase(bankEase) : undefined,
          );
        if (changeEase) changes.ease = typeof ease === 'object' ? { ...ease } : ease;
        if (gradientDraft.action !== 'keep' || gradientTiming.offset>=0) {
          if (r!==colorRecord || (gradientDraft.action!=='keep' && i!==gradientDraft.owner) || (gradientTiming.offset>=0 && i!==gradientTiming.owner) || !gradientStops[gradientStop])
            throw Error('Select the gradient stop again for this tween.');
          const rows=r.span.gradientColorTracks ?? [];
          const row=rows.find(row=>row.stop===gradientStop);
          const existing=row?.keys ?? [];
          let keys=[...existing];
          const kept=rows.filter(row=>row.stop!==gradientStop);
          if (gradientDraft.action==='clear') keys=[];
          else if (gradientDraft.action!=='keep') {
            const offset=gradientDraft.frame-1-r.span.start;
            if (!Number.isSafeInteger(offset) || offset<=0 || offset>=r.span.end-r.span.start) throw Error('Choose an interior gradient key frame.');
            keys=existing.filter(key=>key.offset!==offset);
            if (gradientDraft.action==='set') keys.push({offset,color:gradientDraft.value});
            else if (keys.length===existing.length) throw Error('No color key at this frame for the selected stop.');
          }
          if (keys.length || (row && gradientDraft.action==='keep')) {
            keys.sort((a,b)=>a.offset-b.offset);
            const eases=editedTiming(existing,keys,r.span.end-r.span.start,row?.eases,gradientTiming);
            kept.push({stop:gradientStop,keys,...(eases ? {eases} : {})});
          } else if (gradientTiming.offset>=0) {
            throw Error('Keep the gradient stop track to edit its timing.');
          }
          changes.gradientColorTracks=kept.length ? kept.sort((a,b)=>a.stop-b.stop) : undefined;
        }
        for (const {field, property} of liveColorChannels) {
          const draft = colorDrafts[property];
          if (draft.action === 'keep') continue;
          if (r !== colorRecord || i !== draft.owner)
            throw Error('Choose the color key action again for the selected tween.');
          const existing = r.span[field] ?? [];
          const offset = draft.frame-1-r.span.start;
          if (draft.action === 'clear') changes[field] = undefined;
          else {
            if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= r.span.end-r.span.start)
              throw Error('Choose an interior color key frame.');
            const keys = existing.filter(key => key.offset !== offset);
            if (draft.action === 'set') keys.push({offset, color:draft.value});
            else if (keys.length === existing.length) throw Error('No color key at this frame.');
            changes[field] = keys.length ? keys.sort((a,b)=>a.offset-b.offset) : undefined;
          }
        }
        for (const {field, property} of liveNumericChannels) {
          const draft = numericDrafts[property];
          if (draft.action === 'keep') continue;
          if (r !== colorRecord || i !== draft.owner)
            throw Error('Choose the position key action again for the selected tween.');
          const existing = r.span[field] ?? [];
          const offset = draft.frame-1-r.span.start;
          if (draft.action === 'clear') changes[field] = undefined;
          else {
            if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= r.span.end-r.span.start)
              throw Error('Choose an interior position key frame.');
            const keys = existing.filter(key => key.offset !== offset);
            if (draft.action === 'set') keys.push({offset, value:property !== 'x' && property !== 'y' && property !== 'rotation' ? draft.value / 100 : draft.value});
            else if (keys.length === existing.length) throw Error('No '+property+' key at this frame.');
            changes[field] = keys.length ? keys.sort((a,b)=>a.offset-b.offset) : undefined;
          }
        }
        for(const axis of ['x','y','opacity','rotation','sx','sy','shear','fill','stroke'] as const){
          const draft=intervalTiming[axis], field=axis==='sx'?'scaleXKeys':axis==='sy'?'scaleYKeys':axis==='fill'||axis==='stroke'?`${axis}ColorKeys` as const:`${axis}Keys` as const, timingField=`${axis}KeyEases` as const;
          if(draft.offset<0 && !Object.hasOwn(changes,field))continue;
          if(draft.offset>=0 && (r!==colorRecord || i!==draft.owner))throw Error('Choose the timing interval again for the selected tween.');
          const keys=Object.hasOwn(changes,field)?changes[field]:r.span[field], saved=r.span[timingField];
          if(!keys){
            if(saved)changes[timingField]=undefined;
            if(draft.offset>=0)throw Error('Keep the property track to edit its timing.');
            continue;
          }
          const length=r.span.end-r.span.start;
          const timing=editedTiming(r.span[field]??[],keys,length,saved,draft);
          if(timing)changes[timingField]=timing;
          else if(saved)changes[timingField]=undefined;
        }
        if (opacityMode !== 'keep')
          changes.opacityEase = opacityMode === 'inherit' ? undefined : copyEase(opacityEase);
        if (paintMode !== 'keep')
          changes.paintEase = paintMode === 'inherit' ? undefined : copyEase(paintEase);
        if (pathMode === 'guide') {
          const choice = guides[guideIndex];
          if (!choice || choice.binding.layerId === r.layerId) throw Error('Choose a guide on another layer.');
          if (!Number.isFinite(guideOffsetX) || !Number.isFinite(guideOffsetY))
            throw Error('Enter both guide offsets in document units.');
          changes.guide = { ...choice.binding,
            ...(r.span.guide?.interval ? {interval:r.span.guide.interval} : {}),
            ...(guideOffsetX || guideOffsetY ? { offset: { x:guideOffsetX, y:guideOffsetY } } : {}),
            ...(guideTangent ? { tangent:true } : {}) };
          changes.path = undefined;
        } else if (pathMode !== 'keep') {
          if (r.span.guide) changes.guide = undefined;
          changes.path =
            pathMode === 'remove'
              ? undefined
              : {
                  ...pathControls,
                  ...(pathDistance ? { distance: true } : {}),
                  ...(pathTangent ? { tangent: true } : {}),
                };
        }
        if (clearOptions) changes.options = undefined;
        else if (Object.values(modes).some((v) => v !== 'keep')) {
          const options: MotionSpanOptions = { ...(r.span.options ?? {}) };
          for (const [name] of fields) {
            const mode = modes[name] ?? 'keep';
            if (mode === 'remove') delete options[name];
            else if (mode !== 'keep') options[name] = mode === 'enable';
          }
          changes.options =
            !r.span.options && !Reflect.ownKeys(options).length ? undefined : options;
        }
        return { layerId: r.layerId, spanId: r.spanId, changes };
      });
      const validate = () => {
        if (
          !alive ||
          revision !== owned ||
          JSON.stringify([
            colorDrafts, numericDrafts, intervalTiming, gradientTiming, gradientStop, gradientDraft,
            chosen,
            changeEase,
            ease,
            clearOptions,
            modes,
            opacityMode,
            opacityEase,
            paintMode,
            paintEase,
            pathMode,
            pathControls, guideIndex, guideOffsetX, guideOffsetY, guideTangent,
            pathDistance,
            pathTangent,
            includeGroups,
            includeGraphics,
            includeMovies,
            includeNested,
            groupDirection,
            groupTurnsMode,
            groupTurns,
            groupModes,
            bankMode,
            bankPick,
            bankPoints,
            bankEase,
          ]) !== stamp
        )
          throw Error('Live tween edit choices changed. Try again.');
        // Serialization must not authorize a changed-and-restored input revision.
        if (!alive || revision !== owned)
          throw Error('Live tween edit choices changed. Try again.');
      };
      validate();
      original.apply(requests, validate, nestedScope);
    } catch (cause) {
      if (alive) message = String(cause);
    } finally {
      saving = false;
    }
  }
  onDestroy(() => {
    alive = false;
    revision++;
  });
</script>

<h2>Edit live tween</h2>
<p>
  Change selected live recipes without baking or replacing authored keys. Settings marked Keep
  remain specific to each recipe.
</p>
<label
  ><input
    type="checkbox"
    aria-label="Include graphic live tweens"
    checked={includeGraphics}
    onchange={(e) => {
      includeGraphics = e.currentTarget.checked;
      change();
    }}
  />Include graphic symbol recipes</label
>
{#if includeGraphics}<p>
    Edits preserve each graphic’s authored playback clocks and endpoint keys. Existing
    loop/once/single playback and pure graphic libraries are revalidated. For grouped graphics, also select Include complete group live tweens.
  </p>{/if}
<label
  ><input
    type="checkbox"
    aria-label="Include movie live tweens"
    checked={includeMovies}
    onchange={(e) => {
      includeMovies = e.currentTarget.checked;
      change();
    }}
  />Include movie-clip recipes</label
>
{#if includeMovies}<p>
    Movie clips keep their independent playback and authored first-frame settings. Both endpoints
    and the clip contents are revalidated. Grouped clips and clips containing buttons or other movie
    clips are unavailable.
  </p>{/if}
<label
  ><input
    type="checkbox"
    aria-label="Include nested movie live tweens"
    checked={includeNested}
    onchange={(e) => {
      includeNested = e.currentTarget.checked;
      change();
    }}
  />Include nested movie-clip recipes</label
>
{#if includeNested}<p>
    Nested movie clips keep their independent playback clocks and authored first-frame settings.
    Root endpoints and graphic/movie contents are revalidated. Buttons and grouped roots remain
    unavailable. Ordinary movie inclusion does not select these recipes.
  </p>{/if}
<label
  ><input
    type="checkbox"
    aria-label="Include complete group live tweens"
    checked={includeGroups}
    onchange={(e) => {
      includeGroups = e.currentTarget.checked;
      change();
    }}
  />Include complete outer-group recipes</label
>
{#if includeGroups}
  <fieldset>
    <legend>Group rotation changes</legend>
    <label
      >Direction<select
        aria-label="Edit live group direction"
        value={groupDirection}
        onchange={(e) => {
          groupDirection = e.currentTarget.value as typeof groupDirection;
          change();
        }}
      >
        <option value="keep">Keep each group direction</option><option value="shortest"
          >Shortest</option
        ><option value="clockwise">Clockwise</option><option value="counterclockwise"
          >Counterclockwise</option
        >
      </select></label
    >
    <label
      >Extra turns<select
        aria-label="Edit live group turns mode"
        value={groupTurnsMode}
        onchange={(e) => {
          groupTurnsMode = e.currentTarget.value as typeof groupTurnsMode;
          change();
        }}
        ><option value="keep">Keep each group turn count</option><option value="set"
          >Set whole turns</option
        ></select
      ></label
    >
    {#if groupTurnsMode === 'set'}<label
        >Whole turns<input
          aria-label="Edit live group turns"
          type="number"
          min="0"
          step="1"
          value={groupTurns}
          oninput={(e) => {
            groupTurns = e.currentTarget.valueAsNumber;
            change();
          }}
        /></label
      >{/if}
    {#each groupFields as [key, label]}
      <label
        >{label}<select
          aria-label={'Edit live group ' + key}
          value={groupModes[key] ?? 'keep'}
          onchange={(e) => {
            groupModes = { ...groupModes, [key]: e.currentTarget.value as OptionMode };
            change();
          }}
        >
          <option value="keep">Keep each group setting</option><option value="enable">Enable</option
          ><option value="disable">Disable explicitly</option><option value="remove"
            >Remove setting</option
          >
        </select></label
      >
    {/each}
    <small
      >Rotation changes affect each whole group recipe, including its loose artwork. Group scaling
      and shear govern its outer groups. Plain recipes selected together need a separate explicit
      setting change. Required interpolation options stay independent; incompatible choices reject.
      Saved/custom pivot orbits and inner-level motion remain unavailable.</small
    >
  </fieldset>
{/if}
<fieldset>
  <legend>Existing live tweens</legend>
  {#each records as record, i}
    <label
      ><input
        type="checkbox"
        aria-label={`Edit live tween ${record.name} frames ${record.span.start + 1}–${record.span.end + 1}`}
        data-live-edit-recipe
        checked={chosen.includes(i)}
        disabled={!eligible(record)}
        onchange={(e) => {
          chosen = e.currentTarget.checked ? [...chosen, i] : chosen.filter((n) => n !== i);
          change();
        }}
      />{record.name}: frames {record.span.start + 1}–{record.span.end + 1}</label
    >
    <small
      >Original easing: {typeof record.span.ease === 'string' ? record.span.ease : 'Custom cubic'}.
      Opacity: {channelReadout(record.span.opacityEase)}. Paint: {channelReadout(
        record.span.paintEase,
      )}. Path: {record.span.guide ? 'Linked stage guide · ' + (original.snapshot.layers.find(layer => layer.id === record.span.guide?.layerId)?.name ?? '') : pathReadout(record.span.path)}. Options: {JSON.stringify(
        record.span.options ?? {},
      )}. Rotation: {JSON.stringify(record.span.rotation ?? {})}{record.symbolic
        ? includeGraphics
          ? ' — authored graphic clocks stay unchanged.'
          : ' — explicitly include graphic recipes to edit.'
        : record.movie
          ? includeMovies
            ? ' — authored movie playback stays unchanged.'
            : ' — explicitly include movie-clip recipes to edit.'
          : record.span.symbolContinuity === 'movie-trees'
            ? includeNested
              ? ' — authored nested movie clocks stay unchanged.'
              : ' — explicitly include nested movie recipes to edit.'
            : !record.available
              ? ' — show and unlock this track to edit.'
              : record.grouped && !includeGroups
                ? ' — explicitly include complete-group recipes to edit.'
                : ''}</small
    >
  {/each}
</fieldset>
{#if includeGroups}
  <fieldset>
    <legend>Independent group route</legend>
    <p>
      Choose one selected recipe and an original outer group. These controls affect only that group;
      shared trajectory controls remain separate. Set replaces this group's waypoint route with a
      cubic while retaining its distance timing.
    </p>
    <label
      >Group<select
        aria-label="Independent route group"
        value={bankPick}
        onchange={(e) => chooseBank(e.currentTarget.value)}
        ><option value="">Choose an original group</option>{#each bankChoices as c}<option
            value={c.key}
            >{c.record.name}: {c.groupId} (frames {c.record.span.start + 1} to {c.record.span.end +
              1})</option
          >{/each}</select
      ></label
    >
    <label
      >Action<select aria-label="Independent route action" bind:value={bankMode} onchange={change}
        ><option value="keep">Keep independent routes</option><option value="set"
          >Set independent cubic</option
        >
        {#if bankChoices.some(c => c.key === bankPick && !c.record.span.path && c.record.span.groupPaths?.some(row => row.groupId === c.groupId && row.path.waypoints && !row.path.distance))}
          <option value="timing">Change waypoint route timing</option>
        {/if}
        <option value="remove">Remove this group's route</option></select
      ></label
    >
    {#if bankMode === 'timing'}
      <div oninput={change} onchange={change}>
        <MotionEasing bind:value={bankEase} label="Group route easing" help="Adjust travel along the existing waypoints." />
      </div>
    {:else if bankMode === 'set'}
      {@const choice = bankChoices.find(c => c.key === bankPick)}
      {@const sharedPath = choice?.record.span.path}
      {@const distanceGroup = choice?.record.span.groupPaths?.find(row => row.groupId === choice.groupId)?.path.distance}
      {#if !sharedPath || (!distanceGroup && !sharedPath.curvedWaypoints && !sharedPath.tangent)}
        <div oninput={change} onchange={change}>
          <MotionEasing bind:value={bankEase} label="Group route easing" help="Adjust travel along this group's cubic route." />
        </div>
      {/if}
      <p>
        Enter absolute document X/Y coordinates using the group's original authored leader endpoints
        as references. New routes start with straight controls; values may be outside the stage.
      </p>
      {#each controlFields as field}<label
          >{field.startsWith('start') ? 'Start' : 'End'} control {field.endsWith('X')
            ? 'X'
            : 'Y'}<input
            type="number"
            step="any"
            aria-label={`Independent route ${field}`}
            value={bankPoints[field]}
            oninput={(e) => {
              bankPoints = { ...bankPoints, [field]: e.currentTarget.valueAsNumber };
              change();
            }}
          /></label
        >{/each}
    {/if}
  </fieldset>
{/if}
<label
  ><input
    type="checkbox"
    aria-label="Change live tween easing"
    bind:checked={changeEase}
    onchange={change}
  />Change easing for selected recipes</label
>
{#if colorRecord}
  {#snippet timingControls(timing:ReturnType<typeof timingDraft>,label:string,keys:readonly {offset:number}[],saved:readonly MotionEase[]|undefined)}
    {@const ends=[...keys.map(k=>k.offset),colorRecord!.span.end-colorRecord!.span.start]}
      <label>{label} interval ending at<select aria-label={label+' interval ending at'} bind:value={timing.offset} onchange={()=>{
        timing.owner=chosen[0];timing.ease=copyEase(saved?.[ends.indexOf(timing.offset)]??'linear');change();
      }}>
        <option value={-1}>Keep interval timing</option>
        {#each ends as offset}<option value={offset}>Frame {colorRecord!.span.start+offset+1}</option>{/each}
      </select></label>
      {#if timing.offset>=0}<MotionEasing bind:value={()=>timing.ease,(v)=>{timing.ease=v;change()}} label={label+' interval easing'} help="This curve controls the selected property between these two keys."/>{/if}
  {/snippet}
  {#each liveNumericChannels as channel}
  {@const draft = numericDrafts[channel.property]}
  {@const coordinate = channel.property === 'x' || channel.property === 'y'}
  {@const degrees = channel.property === 'rotation'}
  {#if supportsPlacementChannel(colorRecord.span.symbolContinuity,channel.field) && (!coordinate || !colorRecord.span.path) && (!degrees || !colorRecord.span.path?.tangent)}
  <details>
    <summary>{channel.label}{coordinate ? ' position keys' : ' keys'}</summary>
    {#if channel.property === 'opacity'}
      <p>Choose an interval to change its opacity easing. Removing the opacity track restores endpoint easing.</p>
    {:else if degrees}
      <p>Enter absolute angles in degrees. Positive angles turn clockwise. Keys interpolate directly, so 360° adds a full turn from 0°. Clearing the track restores the tween’s rotation settings.</p>
    {:else if channel.property === 'shear'}
      <p>Enable Scale and skew in Interpolation options. At 100% shear, each local Y unit adds one local X unit before rotation. Use a negative value to skew in the opposite direction.</p>
    {:else if !coordinate}
      <p>Enable Scale and skew in Interpolation options. A reflected vertical scale keeps its negative sign.</p>
    {:else}
      <p>Set a document coordinate at an interior frame. Choose an interval to change its timing.</p>
    {/if}
    {#if colorRecord.span[channel.field]}
      {@render timingControls(intervalTiming[channel.property],channel.label,colorRecord.span[channel.field]!,colorRecord.span[`${channel.property}KeyEases`])}
    {/if}
    {#each colorRecord.span[channel.field] ?? [] as key}
      {@const value = coordinate || degrees ? key.value : key.value * 100}
      <button onclick={() => {
        draft.frame = colorRecord!.span.start+key.offset+1; draft.value = value;
        draft.owner=chosen[0]; draft.action='set'; change();
      }}>Frame {colorRecord.span.start+key.offset+1} · {value}{degrees ? '°' : coordinate ? '' : '%'}</button>
    {/each}
    <label>{channel.label} key action<select bind:value={draft.action} onchange={() => {
      draft.owner=chosen[0];
      if (draft.frame<=colorRecord!.span.start+1 || draft.frame>colorRecord!.span.end)
        draft.frame=colorRecord!.span.start+2;
      change();
    }}>
      <option value="keep">Keep saved keys</option><option value="set">Set key</option>
      <option value="delete">Remove key</option><option value="clear">Remove {channel.property} key track</option>
    </select></label>
    {#if draft.action === 'set' || draft.action === 'delete'}
      <label>{channel.label} key frame<input type="number" min={colorRecord.span.start+2} max={colorRecord.span.end}
        bind:value={draft.frame} oninput={change}/></label>
    {/if}
    {#if draft.action === 'set'}
      <label>{channel.label} {degrees ? '(degrees)' : coordinate ? 'coordinate' : '(%)'}<input type="number" step="any" min={channel.property === 'opacity' ? 0 : undefined} max={channel.property === 'opacity' ? 100 : undefined} bind:value={draft.value} oninput={change}/></label>
    {/if}
  </details>
  {/if}
  {/each}
  {#if gradientStops.length}
    {@const selectedStop=colorRecord.span.gradientColorTracks?.find(row=>row.stop===gradientStop)}
    <details>
      <summary>Gradient stop color keys</summary>
      <p>Enable Paint colors to key a matched stop. Stops at the same offset are listed separately in gradient order.</p>
      <label>Gradient stop<select bind:value={gradientStop} onchange={()=>{gradientDraft=colorDraft();gradientTiming=timingDraft();change()}}>
        {#each gradientStops as stop,index}<option value={index}>Stop {index+1} · {Math.round(stop.offset*100)}% · {stop.color}</option>{/each}
      </select></label>
      {#if selectedStop}{@render timingControls(gradientTiming,'Gradient stop',selectedStop.keys,selectedStop.eases)}{/if}
      {#each selectedStop?.keys ?? [] as key}
        <button onclick={()=>{gradientDraft={owner:chosen[0],action:'set',frame:colorRecord!.span.start+key.offset+1,value:key.color};change()}}>
          Frame {colorRecord.span.start+key.offset+1} · {key.color}
        </button>
      {/each}
      <label>Gradient key action<select bind:value={gradientDraft.action} onchange={()=>{
        gradientDraft.owner=chosen[0];
        if(gradientDraft.frame<=colorRecord!.span.start+1 || gradientDraft.frame>colorRecord!.span.end) gradientDraft.frame=colorRecord!.span.start+2;
        change();
      }}>
        <option value="keep">Keep saved keys</option><option value="set">Set key</option>
        <option value="delete">Remove key</option><option value="clear">Remove this stop's track</option>
      </select></label>
      {#if gradientDraft.action==='set' || gradientDraft.action==='delete'}
        <label>Gradient key frame<input type="number" bind:value={gradientDraft.frame} oninput={change}/></label>
      {/if}
      {#if gradientDraft.action==='set'}<label>Gradient key color<input type="color" bind:value={gradientDraft.value} oninput={change}/></label>{/if}
    </details>
  {/if}
  {#each liveColorChannels as channel}
  {@const draft = colorDrafts[channel.property]}
  {#if !colorRecord.symbolic && !colorRecord.movie && !colorRecord.nested && (channel.property === 'stroke' || canKeyFill)}
  <details>
    <summary>{channel.label} color keys</summary>
    <p>Enable {channel.property === 'stroke' ? 'Stroke color' : 'Paint colors'} in Interpolation options. Choose an interval to change the blend timing.</p>
    {#if colorRecord.span[channel.field]}
      {@render timingControls(intervalTiming[channel.property],channel.label,colorRecord.span[channel.field]!,colorRecord.span[`${channel.property}KeyEases`])}
    {/if}
    {#each colorRecord.span[channel.field] ?? [] as key}
      <button onclick={() => {
        draft.frame = colorRecord!.span.start+key.offset+1; draft.value = key.color;
        draft.owner=chosen[0]; draft.action='set'; change();
      }}>Frame {colorRecord.span.start+key.offset+1} · {key.color}</button>
    {/each}
    <label>{channel.label} key action<select bind:value={draft.action} onchange={() => {
      draft.owner=chosen[0];
      if (draft.frame<=colorRecord!.span.start+1 || draft.frame>colorRecord!.span.end)
        draft.frame=colorRecord!.span.start+2;
      change();
    }}>
      <option value="keep">Keep saved keys</option><option value="set">Set key</option>
      <option value="delete">Remove key</option><option value="clear">Remove {channel.property} key track</option>
    </select></label>
    {#if draft.action === 'set' || draft.action === 'delete'}
      <label>{channel.label} key frame<input type="number" min={colorRecord.span.start+2} max={colorRecord.span.end}
        bind:value={draft.frame} oninput={change}/></label>
    {/if}
    {#if draft.action === 'set'}
      <label>{channel.label} key color<input type="color" bind:value={draft.value} oninput={change}/></label>
    {/if}
  </details>
  {/if}
  {/each}
{/if}
<fieldset>
  <legend>Trajectory</legend>
  <label
    >Path action<select aria-label="Live trajectory mode" bind:value={pathMode} onchange={change}>
      <option value="keep">Keep each existing path</option><option value="replace"
        >Replace whole path with a single cubic</option
      ><option value="guide">Link to a stage guide</option><option value="remove">Remove path</option>
    </select></label
  >
  {#if pathMode === 'guide'}
    <label>Guide artwork<select aria-label="Linked stage guide" bind:value={guideIndex} onchange={change}>
      <option value={-1}>Choose an open path</option>
      {#each guides as guide, i}<option value={i}>{guide.name}</option>{/each}
    </select></label>
    <label>Follower offset X<input aria-label="Guide offset X" type="number" step="any" value={guideOffsetX}
      oninput={(e)=>{guideOffsetX=e.currentTarget.valueAsNumber;change();}} /></label>
    <label>Follower offset Y<input aria-label="Guide offset Y" type="number" step="any" value={guideOffsetY}
      oninput={(e)=>{guideOffsetY=e.currentTarget.valueAsNumber;change();}} /></label>
    <label><input type="checkbox" bind:checked={guideTangent} onchange={change} />Follow guide tangent</label>
    <small>Offsets are measured from the guide to the artwork in document units. Both guide ends plus the offset must meet the authored tween endpoints.</small>
  {:else if pathMode === 'replace'}
    <p>
      This builds a new cubic for every selected recipe. It replaces waypoint, custom-handle and
      heading-correction data. Keep leaves those saved routes unchanged.
    </p>
    <p>
      Offsets are document-space distances from each artwork's original start and end positions.
      Values may lie outside the stage.
    </p>
    {#each controlFields as name}
      <label
        >{name.startsWith('start') ? 'Start' : 'End'} control {name.endsWith('X') ? 'X' : 'Y'} offset<input
          aria-label={`Live cubic ${name}`}
          type="number"
          step="any"
          value={pathControls[name]}
          oninput={(e) => {
            pathControls = { ...pathControls, [name]: e.currentTarget.valueAsNumber };
            change();
          }}
        /></label
      >
    {/each}
    <label
      ><input
        type="checkbox"
        aria-label="Live cubic distance timing"
        bind:checked={pathDistance}
        onchange={change}
      />Travel by distance</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Live cubic tangent heading"
        bind:checked={pathTangent}
        onchange={change}
      />Follow the curve's tangent heading</label
    >
  {:else if pathMode === 'remove'}
    <p>
      Remove only the saved trajectory. Geometry easing, independent channels and authored keys stay
      unchanged.
    </p>
  {/if}
</fieldset>
{#if changeEase}<div oninput={change} onchange={change}>
    <MotionEasing
      bind:value={ease}
      label="Edited live tween easing"
      help="Changes apply to the selected live recipes when you apply this edit."
    />
  </div>{/if}
<fieldset>
  <legend>Independent channels</legend>
  <label
    >Opacity timing<select
      aria-label="Live opacity easing mode"
      bind:value={opacityMode}
      onchange={change}
    >
      <option value="keep">Keep each recipe's setting</option><option value="set"
        >Set independent easing</option
      ><option value="inherit">Inherit geometry easing</option>
    </select></label
  >
  {#if opacityMode === 'set'}<div oninput={change} onchange={change}>
      <MotionEasing
        bind:value={opacityEase}
        label="Live opacity easing"
        help="Opacity changes independently of geometry when you apply this edit."
      />
    </div>{/if}
  <label
    >Paint timing<select
      aria-label="Live paint easing mode"
      bind:value={paintMode}
      onchange={change}
    >
      <option value="keep">Keep each recipe's setting</option><option value="set"
        >Set independent easing</option
      ><option value="inherit">Inherit geometry easing</option>
    </select></label
  >
  {#if paintMode === 'set'}<div oninput={change} onchange={change}>
      <MotionEasing
        bind:value={paintEase}
        label="Live paint easing"
        help="Paint changes independently of geometry when you apply this edit."
      />
    </div>{/if}
  <small
    >Independent paint timing requires Paint colors to be enabled explicitly in Interpolation option
    changes. Inherit removes only that channel's separate timing.</small
  >
</fieldset>
<details>
  <summary>Interpolation option changes</summary>
  <label
    ><input
      type="checkbox"
      aria-label="Remove all live tween options"
      bind:checked={clearOptions}
      onchange={change}
    />Remove all interpolation options from selected recipes</label
  >
  <p>
    Removing required options can reject the edit. Independent channel and trajectory settings are
    retained.
  </p>
  {#each fields as [name, label]}
    <label
      >{label}<select
        aria-label={`Edit live option ${name}`}
        value={modes[name] ?? 'keep'}
        disabled={clearOptions}
        onchange={(e) => {
          modes = { ...modes, [name]: e.currentTarget.value as OptionMode };
          change();
        }}
      >
        <option value="keep">Keep each recipe's setting</option><option value="enable"
          >Enable</option
        ><option value="disable">Disable explicitly</option><option value="remove"
          >Remove this setting</option
        >
      </select></label
    >
  {/each}
  <small
    >Advanced gradient-stop settings stay unchanged unless all options are explicitly removed.
    Dependencies are never enabled automatically.</small
  >
</details>
<button disabled={!chosen.length || !changed || saving} onclick={save}
  >Apply live tween changes</button
>
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
