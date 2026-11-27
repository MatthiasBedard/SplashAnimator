<script lang="ts">
  import { appendHistory, HistoryEntry, moveHistory } from '../../../packages/document/src/history-storage';
  import { untrack, onDestroy, onMount, tick } from 'svelte';
  import TimelinePanel from './TimelinePanel.svelte';
  import { shortcutForKey, type ShortcutOverrides } from './editor-shortcuts';
  import TimelineLayerControls from './TimelineLayerControls.svelte';
  import WorkspaceDivider from './WorkspaceDivider.svelte';
  import ContextMenu, { type ContextAction } from './ContextMenu.svelte';
  import LayerProperties from './LayerProperties.svelte';
  import { showFocusedDialog, wrapDialogTab } from './dialog-focus';
  import { paintTimeline } from './timeline-paint';
  import { DEFAULT_FRAME_WIDTH } from './timeline-zoom';
  import {
    symbolMultiFrameProject,
    symbolFromMultiFrameProject,
  } from '../../../packages/animation/src/symbol-multi-frame';
  import { prepareTimelineFrameMove } from './timeline-frame-move';
  import { captureAnimatedFrameClipboard, prepareAnimatedFramePaste, type AnimatedFrameClipboard } from '../../../packages/animation/src/animated-frame-clipboard';
  import { prepareTimelineFrameInsertion, type TimelineCellCommand } from './timeline-keyframe';
  import { openMotionAt, timelineTweenCell, tweenCellKind } from './timeline-tween-cell';
  import { adjacentKey, removeLayerKeyframes, transferFrameBlock } from '../../../packages/animation/src/timeline';
  import {
    clone,
    id,
    keyAt,
    symbolLayers,
    type Project,
    type SymbolDefinition,
    type Vector,
  } from '../../../packages/document/src';
  import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
  import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
  import { refreshChangedSymbolMotionSpans } from '../../../packages/animation/src/motion-spans';
  import { createSymbolPreviewClock } from '../../../packages/animation/src/symbol-preview-clock';
  import { expandSymbols } from '../../../packages/geometry/src/symbols';
  import {
    copySymbolTracks,
    cutSymbolTracks,
    insertSymbolTracks,
    editSymbolTracks,
    type SymbolTrackClip,
  } from '../../../packages/animation/src/symbol-timeline';
  import {
    symbolTrackEditContext,
    type SymbolEditContext,
  } from '../../../packages/geometry/src/symbol-context';
  import { captureFrameSymbolSimplifyContext } from './frame-symbol-simplify-context';
  import type { StaticSymbolSimplifyContext } from './symbol-simplify-context';
  import SymbolEditor from './SymbolEditor.svelte';
  import SymbolTimeline from './SymbolTimeline.svelte';
  import type { SymbolDrawingSettings } from './symbol-drawing-settings';

  let {
    definition,
    assets,
    symbols,
    fps,
    sceneName = 'Scene 1',
    readSourceProject,
    validate,
    apply,
    cancel,
    context,
    stageCamera,
    initialDrawing,
    shortcutOverrides = {},
    macShortcuts = false,
    timelineHeight = 267,
    timelineMax = 600,
    previewTimeline,
    commitTimeline,
    stageValidate,
    simplify,
    navigate,
    returnTo,
    returnName,
  }: {
    definition: SymbolDefinition;
    assets: Project['assets'];
    symbols: SymbolDefinition[];
    fps: number;
    sceneName?: string;
    readSourceProject: () => { project: Project; revision: number };
    validate: (d: SymbolDefinition) => void;
    apply: (d: SymbolDefinition, admit?: () => void) => string | null;
    cancel: () => void;
    context?: SymbolEditContext;
    stageCamera?: { x: number; y: number; zoom: number };
    initialDrawing: SymbolDrawingSettings;
    shortcutOverrides?: ShortcutOverrides;
    macShortcuts?: boolean;
    timelineHeight?: number;
    timelineMax?: number;
    previewTimeline?: (n: number | null) => void;
    commitTimeline?: (n: number) => void;
    stageValidate?: () => void;
    simplify?: (artwork: Vector[]) => StaticSymbolSimplifyContext;
    navigate?: (id: string, location: { layerId: string; frame: number }) => string | null;
    returnTo?: () => string | null;
    returnName?: string;
  } = $props();
  let draft = $state(untrack(() => clone(definition))),
    frame = $state(untrack(() => context?.initialFrame ?? 0)),
    layerId = $state('@base');
  let epoch = $state(0),
    error = $state(''),
    advanced = $state.raw<typeof readSourceProject>(),
    publishing = false,
    poisoned = false;
  let editor = $state<SymbolEditor>();
  let drawing = $state(untrack(() => ({ ...initialDrawing })));
  let viewport = $state({ scale: 1, pan: { x: 0, y: 0 } });
  let futureCell = $state.raw<{ track: string; at: number } | null>(null);
  let futureRange = $state.raw<{ source: SymbolDefinition; start: number; end: number } | null>(null);
  let workspaceRoot: HTMLElement, clipboard: SymbolTrackClip | AnimatedFrameClipboard | undefined;
  let alive = true;
  onDestroy(() => {
    stopTimelineGesture();
    alive = false;
  });
  type Snapshot = { definition: SymbolDefinition; frame: number; layerId: string };
  let past = $state.raw<HistoryEntry<Snapshot>[]>([]),
    future = $state.raw<HistoryEntry<Snapshot>[]>([]);
  const duration = $derived(draft.timeline?.duration ?? 1),
    layers = $derived(symbolLayers(draft));
  const layer = $derived(layers.find((l) => l.id === layerId) ?? layers[0]);
  const artwork = $derived(keyAt(layer, frame).shapes);
  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(definition));
  const sourceOwner = untrack(() => {
    const s = readSourceProject();
    return { source: s.project, revision: s.revision, stamp: stamp(s.project) };
  });
  function current() {
    if (!alive) throw Error('Symbol workspace is closed.');
    const live = readSourceProject();
    stageValidate?.();
    validateLiveGraphicData(live.project);
    if (
      live.project !== sourceOwner.source ||
      live.revision !== sourceOwner.revision ||
      stamp(live.project) !== sourceOwner.stamp
    )
      throw Error('The original symbol source changed. Cancel and reopen editing.');
  }
  let advancedScriptFrame = $state<number>();
  let advancedTimelineButton = $state<HTMLButtonElement>();
  async function closeAdvancedTimeline() {
    const target = advancedScriptFrame === undefined ? advancedTimelineButton : timelineCanvas;
    advanced = undefined;
    await tick();
    if (alive && !advanced && target?.isConnected) target.focus({ preventScroll: true });
  }
  function openAdvancedTimeline(scriptFrame?: number) {
    if (advanced || !flush()) return;
    const original = draft, at = frame, track = layerId, revision = epoch;
    const verify = () => {
      if (!alive || advanced !== read || draft !== original || frame !== at || layerId !== track || epoch !== revision)
        throw Error('The shared symbol draft changed. Reopen Timeline tools.');
    };
    function read() {
      verify();
      const enclosing = readSourceProject();
      verify();
      return enclosing;
    }
    advancedScriptFrame = scriptFrame;
    advanced = read;
  }
  function snapshot(): Snapshot {
    return { definition: clone(draft), frame, layerId };
  }
  function commit(next: SymbolDefinition, admit?: () => void) {
    admit?.();
    current();
    validateLiveGraphicData(next);
    const expected = stamp(next),
      before = snapshot(),
      original = draft,
      originalStamp = stamp(draft),
      oldPast = past,
      oldFuture = future,
      at = frame,
      track = layerId;
    validate(next);
    const changed = JSON.stringify(next) !== JSON.stringify(original);
    const nextPast = changed ? appendHistory(oldPast, new HistoryEntry(before)) : oldPast;
    admit?.();
    current();
    if (
      draft !== original ||
      stamp(draft) !== originalStamp ||
      past !== oldPast ||
      future !== oldFuture ||
      frame !== at ||
      layerId !== track
    )
      throw Error('Original symbol workspace changed during preparation.');
    if (stamp(next) !== expected) throw Error('Prepared symbol artwork changed.');
    if (changed) {
      past = nextPast;
      future = [];
      draft = next;
    }
  }
  function writeArtwork(next: SymbolDefinition, shapes: Vector[]) {
    const target = symbolLayers(next).find((l) => l.id === layerId);
    if (!target || target.locked || !target.visible)
      throw Error('Choose a visible unlocked symbol layer.');
    if (layerId === '@base' && frame === 0) next.shapes = clone(shapes);
    else {
      next.timeline ??= { duration: Math.max(1, frame + 1), keys: [] };
      if (layerId === '@base')
        next.timeline.keys = [
          ...next.timeline.keys.filter((k) => k.frame !== frame),
          { frame, shapes: clone(shapes) },
        ].sort((a, b) => a.frame - b.frame);
      else
        target.keys = [
          ...target.keys.filter((k) => k.frame !== frame),
          { frame, shapes: clone(shapes) },
        ].sort((a, b) => a.frame - b.frame);
    }
  }
  function keepArtwork(shapes: Vector[], admit?: () => void): string | null {
    if (publishing) {
      poisoned = true;
      return 'Symbol frame publication cannot reenter.';
    }
    publishing = true;
    poisoned = false;
    try {
      current();
      validateLiveGraphicData(shapes);
      const input = stamp(shapes),
        before = stamp(draft),
        at = frame,
        track = layerId;
      const active = () => {
        admit?.();
        current();
        if (
          poisoned ||
          frame !== at ||
          layerId !== track ||
          stamp(shapes) !== input ||
          stamp(draft) !== before
        )
          throw Error('Original frame artwork or input changed.');
      };
      active();
      let next = clone(draft);
      writeArtwork(next, shapes);
      let warning = '';
      try {
        next = refreshChangedSymbolMotionSpans(draft, next, symbols, true);
      } catch (cause) {
        warning = `Endpoint edit kept; automatic motion refresh failed: ${String(cause)}`;
      }
      validate(next);
      active();
      commit(next);
      error = warning;
      return null;
    } catch (cause) {
      return String(cause);
    } finally {
      publishing = false;
    }
  }
  function flush() {
    if (playbackSession) {
      stopPlayback();
      return true;
    }
    const failure = editor?.flush();
    if (failure) {
      error = failure;
      return false;
    }
    return true;
  }
  function selectFrame(track: string, at: number, internal = false) {
    if (!internal) stopTimelineGesture();
    if (track === layerId && at === frame) {
      if (playing) stopPlayback();
      futureRange = null;
      futureCell = null;
      return true;
    }
    if (!Number.isSafeInteger(at) || at < 0 || at >= 10000 || !layers.some((l) => l.id === track))
      return false;
    if (!flush()) return false;
    futureRange = null;
    futureCell = null;
    layerId = track;
    frame = at;
    epoch++;
    error = '';
    return true;
  }
  function keyframe(blank = false) {
    const at = futureCell?.at ?? frame;
    const target = layers.find((l) => l.id === (futureCell?.track ?? layerId)) ?? layer;
    const tween = timelineTweenCell(target, at);
    insertCell(blank ? 'blank' : !openMotionAt(target, at) && tween && at > tween.span.end ? 'plain' : 'key');
  }
  function insertCell(action: TimelineCellCommand) {
    stopTimelineGesture();
    if (!flush()) return;
    try {
      const pending = futureCell;
      const original = draft,
        oldPast = past,
        oldFuture = future,
        sourceFrame = frame,
        sourceTrack = layerId,
        at = pending?.at ?? frame,
        track = pending?.track ?? layerId,
        serial = epoch;
      const admit = () => {
        current();
        if (
          draft !== original ||
          past !== oldPast ||
          future !== oldFuture ||
          frame !== sourceFrame ||
          layerId !== sourceTrack ||
          futureCell !== pending ||
          epoch !== serial
        )
          throw Error('The original symbol frame input changed during preparation.');
      };
      const input = structuredClone(
          $state.snapshot(symbolMultiFrameProject(draft, symbols, assets)),
        ),
        candidate = prepareTimelineFrameInsertion(input, track, at, action, admit, draft.id);
      admit();
      const next = fromProject(candidate);
      if (track === '@base' && (action === 'remove-motion' || action === 'remove-shape')) {
        const spans = candidate.layers.find((l) => l.id === track)!.motionSpans;
        if (spans) next.timeline!.motionSpans = spans;
        else delete next.timeline!.motionSpans;
      }
      commit(next, admit);
      if (pending) {
        futureCell = null;
        frame = at;
        layerId = track;
        selectedTracks = [track];
        rangeStart = rangeEnd = at;
        blockSelected = false;
      }
      epoch++;
      error = '';
    } catch (cause) {
      error = String(cause);
    }
  }
  function extend(value: number) {
    if (!flush()) return;
    try {
      if (!Number.isSafeInteger(value) || value < 1 || value > 10000)
        throw Error('Choose a symbol duration from 1 to 10000 frames.');
      const next = clone(draft);
      next.timeline ??= { duration: 1, keys: [] };
      next.timeline.duration = value;
      commit(next);
      frame = Math.min(frame, value - 1);
      epoch++;
      error = '';
    } catch (cause) {
      error = String(cause);
    }
  }
  function addLayer() {
    stopTimelineGesture();
    if (!flush()) return;
    try {
      const next = clone(draft);
      next.timeline ??= { duration: 1, keys: [] };
      const target = {
        id: id(),
        name: `Layer ${layers.length + 1}`,
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: [] }],
      };
      next.timeline.layers = [...(next.timeline.layers ?? []), target];
      commit(next);
      selectedTracks = [target.id];
      rangeStart = rangeEnd = 0;
      layerId = target.id;
      frame = 0;
      epoch++;
    } catch (cause) {
      error = String(cause);
    }
  }
  function undo(redo = false) {
    stopTimelineGesture();
    if (!flush()) return;
    const stack = redo ? future : past;
    if (!stack.length) return;
    try {
      current();
      const next = stack.at(-1)!.read();
      validate(next.definition);
      current();
      const to = redo ? past : future;
      const inverse = new HistoryEntry(snapshot());
      const moved = moveHistory(stack, to, inverse);
      current();
      if (stack !== (redo ? future : past) || to !== (redo ? past : future))
        throw Error('Symbol history changed during preparation.');
      past = redo ? moved.destination : moved.source;
      future = redo ? moved.source : moved.destination;
      draft = next.definition;
      futureCell = null;
      frame = next.frame;
      layerId = next.layerId;
      selectedTracks = [layerId];
      rangeStart = rangeEnd = frame;
      blockSelected = false;
      epoch++;
      error = '';
    } catch (cause) {
      error = String(cause);
    }
  }
  function save() {
    if (!flush()) return;
    try {
      current();
      const expected = stamp(draft),
        at = frame,
        track = layerId;
      const active = () => {
        current();
        if (stamp(draft) !== expected || frame !== at || layerId !== track)
          throw Error('Symbol workspace changed before publication.');
      };
      const candidate = clone(draft);
      active();
      error = apply(candidate, active) ?? '';
    } catch (cause) {
      error = String(cause);
    }
  }
  function frameSimplify(shapes: Vector[]): StaticSymbolSimplifyContext {
    if (!draft.timeline && !draft.buttonStates && simplify) return simplify(shapes);
    current();
    const local = draft,
      oldPast = past,
      oldFuture = future,
      at = frame,
      track = layerId,
      token = {};
    const live = readSourceProject(),
      projectCopy = clone(live.project),
      definitionCopy = clone(draft),
      localStamp = stamp(draft),
      history = { past, future };
    return captureFrameSymbolSimplifyContext(() => {
      current();
      return {
        project: projectCopy,
        definition: definitionCopy,
        history,
        session: token,
        revision: live.revision,
        location: { layerId: track, frame: at },
        context: `${track}:${at}:${epoch}`,
        eligible:
          draft === local &&
          past === oldPast &&
          future === oldFuture &&
          frame === at &&
          layerId === track &&
          stamp(draft) === localStamp,
      };
    }, shapes);
  }
  const editingContext = $derived.by(() => {
    if (frame >= duration) return context;
    const base = context ?? {
      initialFrame: 0,
      artworkFrame: 0,
      matrix: [1, 0, 0, 1, 0, 0] as const,
      under: [],
      over: [],
      width: draft.width,
      height: draft.height,
      background: '#ffffff',
      opacity: 1,
    };
    return playing ? base : symbolTrackEditContext(base, draft, layerId, frame, symbols);
  });
  function openNested(instance: string) {
    if (dirty) return 'Save current symbol edits before opening a nested definition.';
    return navigate?.(instance, { layerId, frame }) ?? null;
  }
  function back() {
    if (!flush()) return;
    if (dirty) {
      error = 'Save current symbol edits before returning to its parent.';
      return;
    }
    error = returnTo?.() ?? '';
  }
  function command(
    action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'clear' | 'remove' | 'remove-keys' | 'undo' | 'redo',
  ) {
    stopTimelineGesture();
    if (action === 'undo' || action === 'redo') {
      undo(action === 'redo');
      return;
    }
    if (futureCell) return;
    if (!flush()) return;
    try {
      current();
      const original = draft,
        oldPast = past,
        oldFuture = future,
        at = frame,
        track = layerId,
        serial = epoch,
        range = stamp([selectedTracks, rangeStart, rangeEnd]), previousClip = clipboard;
      const active = () => {
        current();
        if (
          draft !== original ||
          past !== oldPast ||
          future !== oldFuture ||
          frame !== at ||
          layerId !== track ||
          epoch !== serial ||
          stamp([selectedTracks, rangeStart, rangeEnd]) !== range || clipboard !== previousClip
        )
          throw Error('Original symbol frame clipboard input changed.');
      };
      if ((action === 'copy' || action === 'cut') && layers.some(l => selectedTracks.includes(l.id) && l.motionSpans?.length)) {
        const source = $state.snapshot(symbolMultiFrameProject(draft, symbols, assets));
        const capture = captureAnimatedFrameClipboard(source, selectedTracks, rangeStart, rangeEnd, action === 'cut');
        active();
        if (action === 'cut') commit(fromProject(capture.project), active);
        clipboard = capture.clipboard;
      } else if (action === 'copy') {
        const copied = copySymbolTracks(
          draft,
          selectedTracks,
          rangeStart,
          rangeEnd,
          symbols,
          assets,
        );
        active();
        clipboard = copied;
      } else if (action === 'cut') {
        const result = cutSymbolTracks(
          draft,
          selectedTracks,
          rangeStart,
          rangeEnd,
          symbols,
          assets,
        );
        active();
        commit(result.definition, active);
        clipboard = result.clipboard;
      } else if (action === 'paste') {
        if (!clipboard) return;
        const next = clone(draft);
        next.timeline ??= { duration: 1, keys: [] };
        next.timeline.duration = Math.max(next.timeline.duration, frame);
        const index = orderedLayers.findIndex((l) => l.id === layerId),
          targets = orderedLayers.slice(index, index + clipboard.tracks.length).map((l) => l.id);
        if (targets.length !== clipboard.tracks.length)
          throw Error('Choose enough destination symbol layers for the copied frame block.');
        const prepared = 'kind' in clipboard
          ? fromProject(prepareAnimatedFramePaste($state.snapshot(symbolMultiFrameProject(draft, symbols, assets)), frame, targets, clipboard))
          : insertSymbolTracks(next, frame, clipboard, targets, symbols, assets);
        active();
        commit(prepared, active);
        selectedTracks = targets;
        rangeStart = frame;
        rangeEnd = frame + ('kind' in clipboard ? clipboard.duration : clipboard.tracks[0].clip.duration) - 1;
        blockSelected = true;
      } else if (action === 'remove-keys') {
        const project = $state.snapshot(symbolMultiFrameProject(draft, symbols, assets));
        const originalLayers = stamp(project.layers);
        removeLayerKeyframes(project, selectedTracks, rangeStart, rangeEnd, draft.id);
        active();
        if (stamp(project.layers) === originalLayers) return;
        commit(fromProject(project), active);
      } else
        commit(
          editSymbolTracks(draft, selectedTracks, rangeStart, rangeEnd, action, symbols, assets),
          active,
        );
      if (action === 'remove') {
        frame = rangeEnd = rangeStart;
        selectedTracks = [layerId];
        blockSelected = false;
      }
      epoch++;
      error = '';
    } catch (cause) {
      error = String(cause);
    }
  }
  let timelineCanvas = $state<HTMLCanvasElement>()!;

  let timelineWidth = $state(0),
    cellWidth = $state(DEFAULT_FRAME_WIDTH),
    frameStart = $state(0),
    layerStart = $state(0),
    playing = $state(false);
  let selectedTracks = $state<string[]>(['@base']),
    rangeStart = $state(0),
    rangeEnd = $state(0),
    blockSelected = $state(false);
  const futureBlock = $derived(blockSelected && futureRange?.source === draft ? futureRange : null);
  let renaming = $state.raw<{
    id: string;
    name: string;
    source: SymbolDefinition;
    at: number;
    epoch: number;
  } | null>(null);
  let layerDialog = $state.raw<{
    layer: typeof layer;
    source: SymbolDefinition;
    epoch: number;
  } | null>(null);
  async function dismissLayerProperties() {
    const id = layerDialog?.layer.id;
    layerDialog = null;
    error = '';
    await tick();
    if (!alive || layerDialog || advanced || !id) return;
    const row = workspaceRoot.querySelector<HTMLButtonElement>(
      `[data-symbol-layer="${CSS.escape(id)}"] button.layer-name`,
    );
    (row ?? timelineCanvas)?.focus({ preventScroll: true });
  }
  let contextMenu = $state.raw<{ x: number; y: number; items: ContextAction[] } | null>(null);
  let contextReturn: HTMLElement | undefined;
  function closeContextMenu() {
    contextMenu = null;
    const target = contextReturn;
    contextReturn = undefined;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
  const timelineContent = $derived(Math.max(56, timelineHeight - 74)),
    rowCount = $derived(Math.max(1, Math.floor((timelineContent - 25) / 28)));
  const orderedLayers = $derived([...layers].reverse()),
    visibleLayers = $derived(orderedLayers.slice(layerStart, layerStart + rowCount));
  type PointerOwner = {
    pointer: number;
    source: SymbolDefinition;
    stamp: string;
    past: HistoryEntry<Snapshot>[];
    future: HistoryEntry<Snapshot>[];
    track: string;
    anchor: number;
    kind: 'scrub' | 'select' | 'move';
    origin: number;
    originTrack: string;
    copy: boolean;
    start: number;
    end: number;
    tracks: string[];
    target: string;
    at: number;
    prior: {
      frame: number;
      layerId: string;
      tracks: string[];
      start: number;
      end: number;
      block: boolean;
      pick: typeof futureCell;
      range: typeof futureRange;
    };
  };
  let pointer = $state.raw<PointerOwner | null>(null),
    layerDrag: {
      id: string;
      source: SymbolDefinition;
      past: HistoryEntry<Snapshot>[];
      future: HistoryEntry<Snapshot>[];
    } | null = null;
  function cell(e: Pick<MouseEvent, 'clientX' | 'clientY'>) {
    const r = timelineCanvas.getBoundingClientRect();
    return {
      at: Math.max(0, Math.min(9999, frameStart + Math.floor((e.clientX - r.left) / cellWidth))),
      track:
        visibleLayers[
          Math.max(0, Math.min(visibleLayers.length - 1, Math.floor((e.clientY - r.top - 25) / 28)))
        ]?.id,
      header: e.clientY < r.top + 25,
    };
  }
  function pointerCurrent(p: PointerOwner) {
    current();
    if (draft !== p.source || stamp(draft) !== p.stamp || past !== p.past || future !== p.future)
      throw Error('The original symbol timeline changed during dragging.');
  }
  function stopTimelineGesture(restore = false) {
    const p = pointer;
    pointer = null;
    if (p && restore && draft === p.source && past === p.past && future === p.future) {
      frame = p.prior.frame;
      layerId = p.prior.layerId;
      selectedTracks = p.prior.tracks;
      rangeStart = p.prior.start;
      rangeEnd = p.prior.end;
      blockSelected = p.prior.block;
      futureCell = p.prior.pick;
      futureRange = p.prior.range;
      epoch++;
    }
    if (p && timelineCanvas?.hasPointerCapture(p.pointer))
      timelineCanvas.releasePointerCapture(p.pointer);
  }
  function timelineDown(e: PointerEvent) {
    if (e.button !== 0 || e.isPrimary === false || e.pointerType === 'touch' || pointer || advanced)
      return;
    if (!flush()) return;
    const hit = cell(e);
    if (!hit.track) return;
    e.preventDefault();
    timelineCanvas.focus();
    const moving =
      !hit.header &&
      !e.shiftKey &&
      blockSelected &&
      !futureCell && hit.at < duration &&
      selectedTracks.includes(hit.track) &&
      hit.at >= rangeStart &&
      hit.at <= rangeEnd;
    pointer = {
      pointer: e.pointerId,
      source: draft,
      stamp: stamp(draft),
      past,
      future,
      track: e.shiftKey ? layerId : hit.track,
      anchor: e.shiftKey ? rangeStart : hit.at,
      kind: hit.header ? 'scrub' : moving ? 'move' : 'select',
      origin: hit.at,
      originTrack: hit.track,
      copy: e.altKey || e.ctrlKey || e.metaKey,
      start: rangeStart,
      end: rangeEnd,
      tracks: [...selectedTracks],
      target: hit.track,
      at: rangeStart,
      prior: {
        frame,
        layerId,
        tracks: [...selectedTracks],
        start: rangeStart,
        end: rangeEnd,
        block: blockSelected,
        pick: futureCell,
        range: futureRange,
      },
    };
    timelineCanvas.setPointerCapture(e.pointerId);
    timelineMove(e);
  }
  function timelineMove(e: PointerEvent) {
    const p = pointer;
    if (!p || p.pointer !== e.pointerId) return;
    try {
      pointerCurrent(p);
      const hit = cell(e);
      if (!hit.track) return;
      if (p.kind === 'move') {
        pointer = {
          ...p,
          target: hit.track,
          at: Math.max(0, Math.min(9999 - (p.end - p.start), p.start + hit.at - p.origin)),
        };
        return;
      }
      const track = p.kind === 'scrub' ? layerId : p.track;
      if (p.kind === 'select') {
        if (p.origin >= duration && p.anchor === p.origin && hit.at === p.origin && hit.track === p.originTrack) {
          selectFrame(p.prior.layerId, p.prior.frame, true);
          futureCell = { track: hit.track, at: hit.at };
          blockSelected = false;
          return;
        }
        const start = Math.min(p.anchor, hit.at), end = Math.max(p.anchor, hit.at);
        selectFrame(track, start >= duration ? p.prior.frame : Math.min(hit.at, duration - 1), true);
        const a = orderedLayers.findIndex((l) => l.id === p.track),
          b = orderedLayers.findIndex((l) => l.id === hit.track);
        selectedTracks = orderedLayers.slice(Math.min(a, b), Math.max(a, b) + 1).map((l) => l.id);
        rangeStart = Math.min(start, duration - 1);
        rangeEnd = Math.min(end, duration - 1);
        blockSelected = true;
        futureRange = end >= duration ? { source: draft, start, end } : null;
        futureCell = start >= duration ? { track, at: hit.at } : null;
      } else {
        const at = Math.min(hit.at, duration - 1);
        selectFrame(track, at, true);
        rangeStart = rangeEnd = at;
        selectedTracks = [layerId];
        blockSelected = false;
      }
    } catch (cause) {
      stopTimelineGesture(true);
      error = String(cause);
    }
  }
  function fromProject(project: Project) {
    const original = clone(draft);
    original.timeline ??= { duration: project.duration, keys: [] };
    const next = symbolFromMultiFrameProject(original, project);
    next.timeline!.duration = project.duration;
    const spans = project.layers.find(layer => layer.id === '@base')!.motionSpans;
    if (spans) next.timeline!.motionSpans = clone(spans);
    else delete next.timeline!.motionSpans;
    return next;
  }
  function timelineUp(e: PointerEvent) {
    const owned = pointer;
    if (!owned || owned.pointer !== e.pointerId) return;
    timelineMove(e);
    const p = pointer;
    if (!p) return;
    stopTimelineGesture();
    if (p.kind !== 'move') return;
    try {
      pointerCurrent(p);
      const offset =
          orderedLayers.findIndex((l) => l.id === p.target) -
          orderedLayers.findIndex((l) => l.id === p.track),
        targets = p.tracks.map(
          (id) => orderedLayers[orderedLayers.findIndex((l) => l.id === id) + offset]?.id,
        );
      if (targets.some((t) => !t)) throw Error('Choose enough destination symbol layers.');
      if (p.at === p.start && targets.every((t, i) => t === p.tracks[i])) return;
      const maps = p.tracks.map((sourceId, i) => ({ sourceId, targetId: targets[i] })),
        project = structuredClone($state.snapshot(symbolMultiFrameProject(draft, symbols, assets))),
        admit = () => pointerCurrent(p);
      let result: Project;
      if (p.copy) {
        result = clone(project);
        transferFrameBlock(result, maps, p.start, p.end, p.at, true);
      } else result = prepareTimelineFrameMove(project, maps, p.start, p.end, p.at, admit);
      admit();
      commit(fromProject(result));
      selectedTracks = targets;
      layerId = targets[0];
      frame = rangeStart = p.at;
      rangeEnd = p.at + p.end - p.start;
      blockSelected = true;
      epoch++;
      error = '';
    } catch (cause) {
      error = String(cause);
    }
  }
  function layerPatch(id: string, patch: Partial<typeof layer>, admit?: () => void) {
    if (!flush()) return false;
    try {
      const next = clone(draft);
      const l = symbolLayers(next).find((l) => l.id === id);
      if (!l) throw Error('Original layer disappeared.');
      if (id === '@base')
        next.baseLayer = {
          name: l.name,
          visible: l.visible,
          locked: l.locked,
          ...(l.outline !== undefined ? { outline: l.outline } : {}),
          ...(l.outlineColor !== undefined ? { outlineColor: l.outlineColor } : {}),
          ...patch,
        };
      else Object.assign(l, patch);
      commit(next, admit);
      epoch++;
      error = '';
      return true;
    } catch (cause) {
      error = String(cause);
      return false;
    }
  }
  function renameLayer(id: string) {
    stopTimelineGesture();
    if (!flush()) return;
    const l = layers.find((l) => l.id === id);
    if (l) renaming = { id, name: l.name, source: draft, at: frame, epoch };
  }
  function finishRename(name?: string, restore = false) {
    const r = renaming;
    renaming = null;
    if (
      r &&
      name !== undefined &&
      r.source === draft &&
      r.at === frame &&
      r.epoch === epoch &&
      name !== r.name
    )
      layerPatch(r.id, { name });
    if (restore && r)
      void tick().then(() =>
        workspaceRoot
          .querySelector<HTMLButtonElement>(
            `[data-symbol-layer="${CSS.escape(r.id)}"] button.layer-name`,
          )
          ?.focus(),
      );
  }
  function reorderLayer(id: string, target: string, above: boolean) {
    if (id === '@base' || id === target || !flush()) return;
    try {
      const next = clone(draft),
        items = next.timeline?.layers ?? [],
        index = items.findIndex((l) => l.id === id);
      if (index < 0) return;
      const [moving] = items.splice(index, 1);
      const at = target === '@base' ? 0 : items.findIndex((l) => l.id === target) + (above ? 1 : 0);
      items.splice(Math.max(0, at), 0, moving);
      commit(next);
      epoch++;
    } catch (cause) {
      error = String(cause);
    }
  }
  function deleteLayer() {
    if (layerId === '@base' || layer.locked || !flush()) return;
    try {
      const next = clone(draft);
      next.timeline!.layers = next.timeline!.layers!.filter((l) => l.id !== layerId);
      commit(next);
      layerId = '@base';
      selectedTracks = ['@base'];
      epoch++;
    } catch (cause) {
      error = String(cause);
    }
  }
  function layerMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    openLayerMenu(id, e.clientX, e.clientY);
  }
  function openLayerMenu(id: string, x: number, y: number) {
    stopTimelineGesture();
    if (!flush()) return;
    layerId = id;
    selectedTracks = [id];
    contextMenu = {
      x,
      y,
      items: [
        {
          label: 'Layer properties…',
          run: () => {
            error = '';
            layerDialog = { layer: clone(layers.find((l) => l.id === id)!), source: draft, epoch };
          },
        },
        { label: 'Rename layer', run: () => renameLayer(id) },
        { label: 'Delete layer', disabled: id === '@base' || layer.locked, run: deleteLayer },
      ],
    };
  }
  function frameMenu(e: MouseEvent) {
    e.preventDefault();
    const previous = contextMenu;
    openFrameMenu(e.clientX, e.clientY, cell(e));
    if (contextMenu && contextMenu !== previous) contextReturn = timelineCanvas;
  }
  function openFrameMenu(x: number, y: number, c: ReturnType<typeof cell>) {
    const scriptAction = {
      label: 'Script…',
      disabled: c.at >= duration,
      run: () => openAdvancedTimeline(c.at),
    };
    if (c.header) {
      stopTimelineGesture();
      contextMenu = { x, y, items: [scriptAction] };
      return;
    }
    if (!c.track) return;
    if (c.at >= duration) {
      stopTimelineGesture();
      if (!flush()) return;
      futureCell = { track: c.track, at: c.at };
      futureRange = null;
      blockSelected = false;
    } else {
      const range = futureBlock;
      const preserveRange = !futureCell && selectedTracks.includes(c.track) && c.at >= rangeStart && c.at <= rangeEnd;
      futureCell = null;
      selectFrame(c.track, c.at);
      if (c.track !== layerId || c.at !== frame) return;
      if (preserveRange && range) futureRange = range;
      if (!preserveRange) {
        rangeStart = rangeEnd = c.at;
        selectedTracks = [c.track];
        blockSelected = false;
      }
    }
    const target = layers.find((l) => l.id === c.track)!;
    const tween = c.at < duration ? timelineTweenCell(target, c.at) : undefined;
    const kind = c.at < duration && openMotionAt(target, c.at) ? 'motion' : tween && tweenCellKind(tween.span);
    contextMenu = {
      x,
      y,
      items: [
        ...(kind
          ? [
              {
                label: kind === 'motion' ? 'Remove motion tween' : 'Remove shape tween',
                disabled: !layer.visible || layer.locked,
                run: () => insertCell(`remove-${kind}`),
              },
            ]
          : []),
        {
          label: 'Insert frame',
          disabled: target.locked || duration >= 10000,
          run: () => insertCell('frame'),
        },
        { label: 'Insert keyframe', disabled: target.locked, run: () => keyframe() },
        { label: 'Convert to keyframe', disabled: target.locked, run: () => keyframe() },
        scriptAction,
        {
          label: 'Insert blank keyframe',
          disabled: target.locked,
          run: () => keyframe(true),
        },
        {
          label: 'Remove keyframes',
          disabled: rangeEnd === 0 || c.at >= duration || selectedTracks.some(id =>
            layers.find(track => track.id === id)?.locked),
          run: () => command('remove-keys'),
        },
        ...(['copy', 'cut', 'paste', 'clear', 'remove'] as const).map((action) => ({
          label: {
            copy: 'Copy frames',
            cut: 'Cut frames',
            paste: 'Paste frames',
            clear: 'Clear frames',
            remove: 'Delete frames',
          }[action],
          disabled: c.at >= duration || (action === 'remove' && selectedTracks.some(id =>
            layers.find(track => track.id === id)?.locked)),
          run: () => command(action),
        })),
      ],
    };
  }
  type PlaybackTrack = { artwork: Vector[]; outlineColor?: string };
  let playbackTracks = $state.raw<PlaybackTrack[]>([]);
  let playbackSession:
    | {
        draft: SymbolDefinition;
        clock: ReturnType<typeof createSymbolPreviewClock>;
        base: number;
        start?: number;
        frame?: number;
        movieSignature?: string;
      }
    | undefined;
  function stopPlayback() {
    playbackSession = undefined;
    playbackTracks = [];
    playing = false;
  }
  function togglePlayback() {
    stopTimelineGesture();
    if (playing) {
      stopPlayback();
      return;
    }
    if (!flush()) return;
    try {
      current();
      const clock = createSymbolPreviewClock(draft, symbols, fps, 0, duration - 1);
      current();
      playbackSession = { draft, clock, base: frame };
      futureCell = null;
      blockSelected = false;
      selectedTracks = [layerId];
      playing = true;
      updatePlayback(performance.now());
      error = '';
    } catch (cause) {
      stopPlayback();
      error = String(cause);
    }
  }
  function updatePlayback(time: number) {
    const session = playbackSession;
    if (!session || !playing) return;
    const source = readSourceProject();
    if (
      source.project !== sourceOwner.source ||
      source.revision !== sourceOwner.revision ||
      draft !== session.draft
    )
      throw Error('The original symbol timeline changed during playback.');
    session.start ??= time;
    const seconds = Math.max(0, time - session.start) / 1000;
    const position = session.base + Math.floor(seconds * fps);
    const next = position % duration;
    const movies = session.clock.sample(next, seconds, position);
    const signature = JSON.stringify(movies);
    if (session.frame === next && session.movieSignature === signature) return;
    let count = 0;
    const presentation = layers
      .filter((l) => l.visible)
      .map((l) => {
        const key = keyAt(l, next);
        const prefix = l.id === '@base' ? 'root/preview' : 'root/preview/' + l.id;
        const artwork = expandSymbols(
          { symbols },
          key.shapes,
          next - key.frame,
          (shape) => movies[prefix + '/' + shape.id + '/' + shape.symbolId] ?? 0,
        );
        count += artwork.length;
        if (count > 100000) throw Error('Expanded symbol artwork exceeds the frame limit.');
        return { artwork, outlineColor: l.outline ? (l.outlineColor ?? '#00a6b8') : undefined };
      });
    playbackTracks = presentation;
    frame = rangeStart = rangeEnd = next;
    const columns = Math.max(1, Math.floor(timelineWidth / cellWidth));
    if (frame < frameStart || frame >= frameStart + columns) frameStart = Math.max(0, frame - 1);
    session.frame = next;
    session.movieSignature = signature;
  }
  onMount(() => {
    let raf = 0,
      active = true;
    const tick = (time: number) => {
      try {
        updatePlayback(time);
      } catch (cause) {
        stopPlayback();
        error = String(cause);
      }
      if (active) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      active = false;
      playbackSession = undefined;
      cancelAnimationFrame(raf);
    };
  });
  $effect(() => {
    if (timelineCanvas)
      paintTimeline(timelineCanvas, {
        width: timelineWidth,
        height: timelineContent,
        layers: visibleLayers,
        duration,
        frame,
        frameLabels: draft.timeline?.frameLabels,
        frameComments: draft.timeline?.frameComments,
        frameScripts: draft.timeline?.frameScripts,
        frameStart,
        cellWidth,
        layerId,
        start: futureBlock?.start ?? rangeStart,
        end: futureBlock?.end ?? rangeEnd,
        selectedTracks,
        blockSelected,
        hideGeneratedKeyMarkers: true,
        timelineContextCell: futureCell
          ? { layerId: futureCell.track, frame: futureCell.at }
          : null,
        timelineDrag:
          pointer?.kind === 'move' ? { ...pointer, layers: pointer.tracks, cross: true } : null,
      });
  });
  function keys(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || e.getModifierState('AltGraph') ||
        (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable],[role="textbox"]')) return;
    const shortcut=shortcutForKey(e,shortcutOverrides);
    const contextKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
    if (contextKey) {
      const target = e.target as HTMLElement;
      const id = target.matches('button.layer-name, button.layer-option') &&
        target.closest<HTMLElement>('[data-symbol-layer]')?.dataset.symbolLayer;
      if (id) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat || pointer || contextMenu || layerDialog) return;
        const bounds = target.getBoundingClientRect();
        openLayerMenu(id, bounds.left + bounds.width / 2, bounds.bottom);
        if (contextMenu) contextReturn = target;
        return;
      }
    }
    if (e.target === timelineCanvas && contextKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || pointer || !timelineCanvas) return;
      const target = futureCell ?? { at: frame, track: layerId };
      const bounds = timelineCanvas.getBoundingClientRect();
      const column = (target.at - frameStart + 0.5) * cellWidth;
      const row = 25 + (visibleLayers.findIndex(layer => layer.id === target.track) + 0.5) * 28;
      const previous = contextMenu;
      openFrameMenu(bounds.left + Math.max(0, Math.min(bounds.width, column)),
        bounds.top + Math.max(25, Math.min(bounds.height, row)), { ...target, header: false });
      if (contextMenu && contextMenu !== previous) contextReturn = timelineCanvas;
      return;
    }
    if (e.key === 'Escape' && playing) {
      e.preventDefault();
      stopPlayback();
      return;
    }
    if (e.key === 'Escape' && pointer) {
      e.preventDefault();
      stopTimelineGesture(true);
      return;
    }
    if (e.key === 'Escape' && (futureCell || futureBlock ||
      (e.target === timelineCanvas && (blockSelected || rangeEnd > rangeStart)))) {
      e.preventDefault();
      e.stopPropagation();
      futureCell = null;
      futureRange = null;
      blockSelected = false;
      rangeStart = rangeEnd = frame;
      selectedTracks = [layerId];
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey &&
      e.target === timelineCanvas &&
      ['c', 'x', 'v'].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (futureCell) return;
      command(
        k === 'c'
          ? 'copy'
          : k === 'x'
            ? 'cut'
            : 'paste',
      );
      return;
    }
    if (
      e.target === timelineCanvas &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'Delete',
        'Backspace',
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
      stopTimelineGesture();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (futureCell) futureCell = null;
        else command('clear');
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const index = orderedLayers.findIndex((l) => l.id === layerId),
          next = Math.max(
            0,
            Math.min(orderedLayers.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)),
          );
        const target = orderedLayers[next].id;
        if (!selectFrame(target, frame)) return;
        selectedTracks = [layerId];
        rangeStart = rangeEnd = frame;
        blockSelected = false;
        if (next < layerStart) layerStart = next;
        else if (next >= layerStart + rowCount) layerStart = next - rowCount + 1;
      } else {
        const old = frame,
          anchor = old === rangeStart ? rangeEnd : rangeStart,
          direction = e.key === 'ArrowLeft' ? -1 : 1,
          target =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? duration - 1
                : e.ctrlKey || e.metaKey
                  ? adjacentKey(layer, frame, direction, true)
                  : frame + direction;
        if (!selectFrame(layerId, Math.max(0, Math.min(duration - 1, target)))) return;
        rangeStart = e.shiftKey ? Math.min(anchor, frame) : frame;
        rangeEnd = e.shiftKey ? Math.max(anchor, frame) : frame;
        selectedTracks = [layerId];
        blockSelected = rangeStart !== rangeEnd;
        const count = Math.max(1, Math.floor(timelineWidth / cellWidth));
        if (frame < frameStart || frame >= frameStart + count)
          frameStart = Math.max(0, frame - Math.floor(count / 2));
      }
      return;
    }
    if (e.target === timelineCanvas && (shortcut === 'undo' || shortcut === 'redo')) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) command(shortcut);
      return;
    }
    if (shortcut === 'play' && e.target === timelineCanvas) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) togglePlayback();
      return;
    }
    if (shortcut === 'frame' || shortcut === 'removeFrames') {
      e.preventDefault();
      e.stopPropagation();
      if (shortcut === 'removeFrames') {
        if (!futureCell) command('remove');
      }
      else insertCell('frame');
      return;
    }
    if (shortcut === 'keyframe' || shortcut === 'removeKeys' || shortcut === 'blank') {
      e.preventDefault();
      e.stopPropagation();
      if (shortcut === 'removeKeys') {
        if (!futureCell) command('remove-keys');
      } else keyframe(shortcut === 'blank');
    }
  }
</script>

<svelte:window
  onblur={() => {
    stopTimelineGesture(true);
    stopPlayback();
  }}
  onkeydown={(e) => {
    if (!advanced && workspaceRoot?.contains(e.target as Node)) keys(e);
  }}
/>
<section
  bind:this={workspaceRoot}
  class="symbol-workspace"
  tabindex="-1"
  aria-label="Symbol editing workspace"
>
  <header>
    <nav aria-label="Symbol edit breadcrumbs">
      <button class="scene-breadcrumb" onclick={save} title="Save symbol changes and return to the scene">{sceneName}</button
      ><span>›</span>{#if returnTo}<button disabled={dirty} onclick={back}>{returnName}</button
        ><span>›</span>{/if}<strong>{definition.name}</strong>
    </nav>
    <span class="kind"
      >{definition.defaultPlayback === 'movie' ? 'Movie clip' : 'Graphic symbol'}{context
        ? ' · In place'
        : ''}</span
    >
    <button bind:this={advancedTimelineButton} onclick={() => openAdvancedTimeline()}>Timeline tools…</button>
    <button onclick={save}>Save and return to scene</button><button onclick={cancel}
      >Cancel symbol editing</button
    >
  </header>
  <div class="surface">
    {#key playing ? 'playback' : `${layerId}:${frame}:${epoch}`}<SymbolEditor
        bind:this={editor}
        embedded
        {shortcutOverrides}
        {macShortcuts}
        definition={{
          ...draft,
          shapes: !playing && frame < duration && layer.visible ? clone(artwork) : [],
        }}
        {assets}
        {symbols}
        {stageCamera}
        bind:viewport
        bind:canvasTool={drawing.canvasTool}
        bind:newFill={drawing.newFill}
        bind:newStroke={drawing.newStroke}
        bind:newLineWidth={drawing.newLineWidth}
        bind:brushWidth={drawing.brushWidth}
        bind:brushSimplify={drawing.brushSimplify}
        bind:brushLockToCanvas={drawing.brushLockToCanvas}
        bind:brushOptimize={drawing.brushOptimize}
        bind:brushObjects={drawing.brushObjects}
        bind:contactOpacityEnabled={drawing.contactOpacityEnabled}
        bind:strokeOpacityEnabled={drawing.strokeOpacityEnabled}
        bind:contactOpacityMinimum={drawing.contactOpacityMinimum}
        bind:contactOpacityResponse={drawing.contactOpacityResponse}
        bind:removeCoveredStrokes={drawing.removeCoveredStrokes}
        bind:pencilMode={drawing.pencilMode}
        bind:pencilSimplify={drawing.pencilSimplify}
        bind:pencilOptimize={drawing.pencilOptimize}
        bind:pencilObjects={drawing.pencilObjects}
        historyCommand={undo}
        readOnly={playing || frame >= duration || !layer.visible || layer.locked}
        playbackTracks={playing ? playbackTracks : undefined}
        outline={layer.outline}
        outlineColor={layer.outlineColor}
        context={editingContext}
        hierarchyOwner={`${sourceOwner.revision}:${layerId}:${frame}:${epoch}`}
        simplify={(!draft.timeline && simplify) ||
        ((draft.timeline || draft.buttonStates) && layer.keys.some((k) => k.frame === frame))
          ? frameSimplify
          : undefined}
        frameSimplify={!!(draft.timeline || draft.buttonStates)}
        validate={(shapes) => {
          current();
          const next = clone(draft);
          writeArtwork(next, shapes);
          validate(next);
          current();
        }}
        apply={keepArtwork}
        cancel={() => {
          epoch++;
        }}
        navigate={navigate ? openNested : undefined}
      />{/key}
  </div>
  <div class="symbol-timeline-slot" aria-label="Symbol timeline" role="region">
    <TimelinePanel
      id="symbol-timeline-panel"
      bind:canvas={timelineCanvas}
      bind:width={timelineWidth}
      {frame}
      activeLayerName={layer.name}
      frameLabel={draft.timeline?.frameLabels?.find(label => label.frame === frame)?.name}
      frameComment={draft.timeline?.frameComments?.find(comment => comment.frame === frame)?.text}
      frameScript={draft.timeline?.frameScripts?.some(script => script.frame === frame)}
      frameSelection={{ start: futureBlock?.start ?? rangeStart, end: futureBlock?.end ?? rangeEnd, layers: blockSelected || rangeEnd > rangeStart ? selectedTracks.length : 1 }}
      {duration}
      {fps}
      {playing}
      height={timelineContent}
      {frameStart}
      {layerStart}
      {cellWidth}
      frameLimit={10000}
      canZoom={() => !pointer && !layerDialog && !contextMenu}
      changeZoom={view => { cellWidth = view.cellWidth; frameStart = view.frameStart; }}
      layerMax={Math.max(0, layers.length - rowCount)}
      first={() => selectFrame(layerId, 0)}
      last={() => selectFrame(layerId, duration - 1)}
      play={togglePlayback}
      {keyframe}
      removeKey={() => command('remove-keys')}
      {addLayer}
      {deleteLayer}
      shiftLayer={(n) => {
        const index = orderedLayers.findIndex((l) => l.id === layerId),
          target = orderedLayers[index - n];
        if (target) reorderLayer(layerId, target.id, n > 0);
      }}
      deleteDisabled={layerId === '@base' || layer.locked}
      changeFrameStart={(n) => {
        stopTimelineGesture(true);
        frameStart = n;
      }}
      changeLayerStart={(n) => {
        stopTimelineGesture(true);
        layerStart = n;
      }}
      down={timelineDown}
      move={timelineMove}
      up={timelineUp}
      cancel={(e) => {
        if (pointer?.pointer === e.pointerId) stopTimelineGesture(true);
      }}
      blur={() => stopTimelineGesture(true)}
      {keys}
      context={frameMenu}
      keyLabel="Insert symbol keyframe"
      blankLabel="Insert blank symbol keyframe"
      addLabel="Add symbol layer"
    >
      {#snippet divider()}{#if previewTimeline && commitTimeline}<WorkspaceDivider
            label="Resize timeline"
            controls="symbol-timeline-panel"
            orientation="horizontal"
            reverse
            value={timelineHeight}
            min={130}
            max={timelineMax}
            defaultValue={267}
            context={`${frame}:${layerId}:${epoch}`}
            canStart={() => {
              stopTimelineGesture();
              return flush();
            }}
            preview={previewTimeline}
            commit={commitTimeline}
          />{/if}{/snippet}
      {#snippet extras()}<button
          aria-label="Undo symbol timeline change"
          title="Undo symbol timeline change"
          disabled={!past.length}
          onclick={() => undo()}>↶</button
        ><button
          aria-label="Redo symbol timeline change"
          title="Redo symbol timeline change"
          disabled={!future.length}
          onclick={() => undo(true)}>↷</button
        ><label class="duration-label" title="Symbol duration"
          >Frames <input
            aria-label="Symbol duration"
            type="number"
            min="1"
            max="10000"
            value={duration}
            onchange={(e) => extend(e.currentTarget.valueAsNumber)}
          /></label
        >{/snippet}
      {#snippet rows()}{#each visibleLayers as l}<div
            class="layer-row"
            class:current={l.id === layerId}
            role="group"
            aria-label={`Layer row ${l.name}`}
            data-symbol-layer={l.id}
            tabindex="-1"
            draggable={l.id !== '@base' && renaming?.id !== l.id}
            oncontextmenu={(e) => layerMenu(e, l.id)}
            ondragstart={(e) => {
              if (flush()) {
                layerDrag = { id: l.id, source: draft, past, future };
                e.dataTransfer?.setData('text/plain', l.id);
              } else e.preventDefault();
            }}
            ondragover={(e) => {
              if (layerDrag) e.preventDefault();
            }}
            ondragend={() => (layerDrag = null)}
            ondrop={(e) => {
              e.preventDefault();
              const d = layerDrag;
              layerDrag = null;
              if (d && d.source === draft && d.past === past && d.future === future) {
                const r = e.currentTarget.getBoundingClientRect();
                reorderLayer(d.id, l.id, e.clientY < r.top + r.height / 2);
              }
            }}
          >
            <TimelineLayerControls
              layer={l}
              current={l.id === layerId}
              renaming={renaming?.id === l.id}
              name={renaming?.id === l.id ? renaming.name : l.name}
              select={() => {
                selectFrame(l.id, frame);
                selectedTracks = [l.id];
                rangeStart = rangeEnd = frame;
                blockSelected = false;
              }}
              rename={() => renameLayer(l.id)}
              commit={(name, restore) => finishRename(name, restore)}
              cancel={(restore) => finishRename(undefined, restore)}
              toggle={(kind) => {
                stopTimelineGesture();
                layerPatch(l.id, { [kind]: !l[kind] });
              }}
            />
          </div>{/each}{/snippet}
    </TimelinePanel>
  </div>

  {#if error && !layerDialog}<p class="error" role="alert">{error}</p>{/if}
</section>
{#if advanced}
  {@const read = advanced}
  <SymbolTimeline
    readSourceProject={read}
    stageSimplify={stageValidate}
    definition={draft}
    {assets}
    {symbols}
    {fps}
    {context}
    initialScriptFrame={advancedScriptFrame}
    {validate}
    apply={(next) => {
      try {
        read();
        commit(next);
        void closeAdvancedTimeline();
        frame = Math.min(frame, (draft.timeline?.duration ?? 1) - 1);
        epoch++;
        return null;
      } catch (cause) {
        return String(cause);
      }
    }}
    cancel={() => void closeAdvancedTimeline()}
  />{/if}

{#if contextMenu}<ContextMenu {...contextMenu} close={closeContextMenu} />{/if}
{#if layerDialog}<dialog
    class="symbol-layer-dialog"
    use:showFocusedDialog={'input[aria-label="Layer properties name"]'}
    onkeydown={wrapDialogTab}
    oncancel={event => { event.preventDefault(); void dismissLayerProperties(); }}
    aria-label="Layer properties"
  >
    <LayerProperties
      layer={layerDialog.layer}
      allowMask={false}
      cancel={() => void dismissLayerProperties()}
      apply={({ name, visible, locked, outline, outlineColor }, admit) => {
        const owner = layerDialog;
        if (!owner || owner.source !== draft || owner.epoch !== epoch) {
          error = 'The original symbol layer changed. Reopen Layer properties.';
          return;
        }
        try {
          admit?.();
          current();
          if (
            layerPatch(owner.layer.id, { name, visible, locked, outline, outlineColor }, () => {
              admit?.();
              if (layerDialog !== owner || owner.source !== draft || owner.epoch !== epoch)
                throw Error('The original layer properties context changed.');
            })
          )
            void dismissLayerProperties();
        } catch (cause) {
          error = String(cause);
        }
      }}
    />
    {#if error}<p role="alert">{error}</p>{/if}
  </dialog>{/if}

<style>
  .symbol-workspace {
    height: 100%;
    display: grid;
    grid-template-rows: 42px minmax(0, 1fr) var(--timeline-height, 267px);
    grid-template-columns: var(--tools-width, 84px) minmax(0, 1fr) var(--inspector-width, 280px);
    background: #20222a;
    color: #ececf3;
    overflow: hidden;
  }
  header {
    grid-column: 1/-1;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid #454854;
    padding: 4px 10px;
    white-space: nowrap;
    overflow: auto;
  }
  header nav {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: auto;
  }
  button {
    background: #343642;
    color: inherit;
    border: 1px solid #555866;
    border-radius: 3px;
    padding: 5px 8px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .kind {
    font-size: 12px;
    color: #aaaebf;
  }
  .surface {
    grid-column: 1/-1;
    grid-row: 2/4;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  input {
    width: 65px;
  }
  .error {
    position: absolute;
    bottom: var(--timeline-height, 267px);
    left: 55px;
    right: 300px;
    margin: 0;
    padding: 10px;
    background: #482b30;
    color: #ffd5d5;
  }
  .symbol-timeline-slot {
    grid-column: 2;
    grid-row: 3;
    min-width: 0;
    min-height: 0;
    z-index: 1;
  }
  .symbol-layer-dialog {
    background: #292c35;
    color: #e5e7ef;
    border: 1px solid #606575;
    max-width: 460px;
  }
  .duration-label {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .duration-label input {
    width: 60px;
  }
</style>
