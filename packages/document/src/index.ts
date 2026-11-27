import { appendHistory, HISTORY_BYTE_LIMIT, HistoryCapture, HistoryEntry, historyBytes, moveHistory } from './history-storage';
import {validateSavedLayerMasks} from './layer-masks';
import { validateBoneAttachment, validateBoneBinding, type BoneAttachment, type BoneBinding } from './bone-binding';
import { EMBEDDED_FONT_PROJECT_BYTES, validateEmbeddedFont, type EmbeddedFont } from './embedded-font';
import { rejectUnversionedRestrictedArcs } from './motion-restricted-arc';
import { resolveGuideArtwork, validatePositionTiming, validateGradientColorTracks, liveNumericChannels, validateLiveColorKeys, liveColorChannels, type LiveColorKey, validateLiveNumericKeys, type LiveNumericKey, validateLiveMotionData, validateLiveMotionLayer, preflightLiveGraphicSource, type LiveMotionSpan } from './live-motion';
export type { LiveMotionSpan } from './live-motion';
import {prepareRootOpacityBindings,type RootOpacityBinding} from './opacity-bindings';
export type {RootOpacityBinding,OpacityKey} from './opacity-bindings';
import {
  validateMotionContourCorrespondence,
  type MotionContourCorrespondence,
} from './motion-contour';
import { validateMotionGradientStops, type MotionGradientStops } from './motion-gradient';
import { validateMotionEase, type MotionEase } from './motion-ease';
import { validateMotionRotation, type MotionRotation } from './motion-rotation';
import { validateMotionPath, type MotionPath } from './motion-path';
import { validateLibraryOrganization, type LibraryFolder, type LibraryLocation, type LibraryLink } from './library';
import { canonicalTextRuns, type TextRun } from '../../geometry/src/rich-text';
import { validateDynamicTextBinding } from './dynamic-text';
import { readFrameLabels, validateFrameLabels, type FrameLabel } from './frame-labels';
export type { FrameLabel } from './frame-labels';
import { readFrameComments, validateFrameComments, type FrameComment } from './frame-comments';
import { projectWithSceneData, validateSceneCatalog, type SceneCatalog } from './scenes';
import { isBlendMode, type BlendMode } from './blend-modes';
export type { FrameComment } from './frame-comments';
/** Existing per-vector point bound shared with gesture producers. */
export const MAX_VECTOR_POINTS = 100000;
export const MAX_PROJECT_DURATION = 100000;
/** Existing aggregate stored artwork budget across symbol definitions. */
export const MAX_SYMBOL_ARTWORK = 100000;
export type Point = {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
};
export type BezierNode = Point & { in?: Point; out?: Point };
export type Brush = {
  pressure: boolean;
  minimum: number;
  response?: number;
  opacityProfile?: { minimum: number; response: number };
  tilt: boolean;
  twist?: boolean;
  aspect: number;
  angle: number;
};
export type Gradient = {
  kind: 'linear' | 'radial';
  from: Point;
  to: Point;
  transform?: [number, number, number, number];
  stops: { offset: number; color: string; opacity?: number }[];
};
export type Tint = { color: string; amount: number };
export type Vector = {
  id: string;
  bone?: BoneBinding;
  boneAttachment?: BoneAttachment;
  symbolId?: string;
  symbolPlayback?: { mode: 'loop' | 'once' | 'single' | 'movie'; firstFrame: number; keyframeCut?: true };
  instanceName?: string;
  /** Outer-to-inner group ancestry; geometry remains in layer coordinates. */
  groups?: string[];
  kind:
    'rectangle' | 'ellipse' | 'line' | 'path' | 'brush' | 'bezier' | 'polygon' | 'text' | 'symbol';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Additional local affine basis after rotation; preserves original editable geometry. */
  transform?: [number, number, number, number];
  pivot?: Point;
  /** Derive the authoring box from explicit path controls in their saved basis. */
  controlBounds?: true;
  fill: string;
  stroke: string;
  strokeWidth: number;
  points: Point[];
  nodes?: BezierNode[];
  closed?: boolean;
  cornerRadius?: number;
  brush?: Brush;
  fillEnabled?: boolean;
  strokeCap?: 'round' | 'butt' | 'square';
  strokeJoin?: 'round' | 'bevel' | 'miter';
  opacity?: number;
  /** Signed blend of authored RGB paint toward black or white. */
  paintBrightness?: number;
  blurRadius?: number;
  instanceBlur?: number;
  tint?: Tint;
  instanceTint?: Tint;
  instanceBlend?: BlendMode;
  groupBlur?: { group: string; radius: number; tint?: Tint; blendMode?: BlendMode };
  blendMode?: BlendMode;
  text?: {
    content: string;
    dynamicBinding?: string;
    input?: true;
    runs?: TextRun[];
    font: string;
    size: number;
    bold: boolean;
    italic: boolean;
    align: 'left' | 'center' | 'right';
    scaleX?: number;
    scaleY?: number;
    wrapWidth?: number;
    lineHeight?: number;
    letterSpacing?: number;
    wordSpacing?: number;
    direction?: 'ltr' | 'rtl';
    kerning?: 'auto' | 'normal' | 'none';
  };
  contours?: BezierNode[][];
  drawingMode?: 'object' | 'merge';
  fillRule?: 'nonzero' | 'evenodd';
  gradient?: Gradient;
  bitmap?: {
    assetId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    repeat?: boolean;
    transform?: [number, number, number, number];
  };
};
export type OpenMotionTween = { affine: boolean; ease: MotionEase };
export type Keyframe = { frame: number; shapes: Vector[]; openMotionTween?: OpenMotionTween };
export type LayerFolder = { id: string; name: string; parentId?: string };
/** Remembered basic motion recipe; generated keys remain editable until explicitly refreshed. */
export const MOTION_SPAN_OPTIONS = [
  'affine',
  'paint',
  'nodes',
  'primitives',
  'strokeWidth',
  'gradientGeometry',
  'gradientBasis',
  'contourAreas',
  'contourEdges',
  'contourContacts',
  'curveTangents',
  'curveSelfContacts',
  'gradientStops',
  'gradientPremultiplied',
  'pivots',
  'defaultPivots',
  'strokeColor',
] as const;
export type MotionSpanOptions = Partial<
  Record<Exclude<(typeof MOTION_SPAN_OPTIONS)[number], 'gradientStops'>, boolean>
> & { gradientStops?: MotionGradientStops };
export function validateMotionSpanOptions(
  options: unknown,
  topology = true,
  gradientMatching = true,
  advancedGradientMatching = true,
): asserts options is MotionSpanOptions | undefined {
  assert(
    options === undefined ||
      (options !== null &&
        typeof options === 'object' &&
        !Array.isArray(options) &&
        Object.entries(options).every(
          ([key, value]) =>
            (MOTION_SPAN_OPTIONS as readonly string[]).includes(key) &&
            (topology || (MOTION_SPAN_OPTIONS as readonly string[]).indexOf(key) < 7) &&
            (gradientMatching || (MOTION_SPAN_OPTIONS as readonly string[]).indexOf(key) < 12) &&
            (typeof value === 'boolean' ||
              (advancedGradientMatching && key === 'gradientStops' && value !== undefined)),
        )),
    'motion span options',
  );
  const matching = (options as MotionSpanOptions | undefined)?.gradientStops;
  if (matching !== undefined) validateMotionGradientStops(matching);
}
export type BasicMotionSpan = {
  gradientColorTracks?: readonly {stop:number; keys:readonly LiveColorKey[]; eases?:readonly MotionEase[]}[];
  fillColorKeys?: readonly LiveColorKey[];
  strokeColorKeys?: readonly LiveColorKey[];
  shearKeys?: readonly LiveNumericKey[];
  rotationKeys?: readonly LiveNumericKey[];
  scaleXKeys?: readonly LiveNumericKey[];
  scaleYKeys?: readonly LiveNumericKey[];
  fillKeyEases?: readonly MotionEase[];
  strokeKeyEases?: readonly MotionEase[];
  opacityKeyEases?: readonly MotionEase[];
  sxKeyEases?: readonly MotionEase[];
  syKeyEases?: readonly MotionEase[];
  shearKeyEases?: readonly MotionEase[];
  rotationKeyEases?: readonly MotionEase[];
  xKeyEases?: readonly MotionEase[];
  yKeyEases?: readonly MotionEase[];
  xKeys?: readonly LiveNumericKey[];
  yKeys?: readonly LiveNumericKey[];
  opacityKeys?: readonly LiveNumericKey[];
  correspondence?: MotionContourCorrespondence;
  path?: MotionPath;
  rotation?: MotionRotation;
  options?: MotionSpanOptions;
  id: string;
  start: number;
  end: number;
  ease: MotionEase;
  opacityEase?: MotionEase;
  paintEase?: MotionEase;
  autoRefresh?: boolean;
  baseline: string;
};
export type Layer = {
  motionSpans?: BasicMotionSpan[];
  liveMotionSpans?: LiveMotionSpan[];
  folderId?: string;
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  keys: Keyframe[];
  drawingMode?: 'object' | 'merge';
  /** Authoring-view preferences; published artwork and exports ignore these. */
  guideLayer?: true;
  outline?: boolean;
  outlineColor?: string;
};
export type BitmapAsset = { name: string; width: number; height: number; dataUrl?: string };
export type AudioAsset = {name:string;format:'pcm16-wav';sampleRate:number;channels:1|2;frames:number};
export type AudioClip = {id:string;assetId:string;startFrame:number;offsetSamples:number;gain:number;fadeInSamples?:number;fadeOutSamples?:number};
export type Asset = { id: string; path: string; bitmap?: BitmapAsset; audio?:AudioAsset; font?:EmbeddedFont };
export type ButtonStates = { up: number; over: number; down: number; hit: number };
export type SymbolDefinition = {
  /** Persisted authoring metadata for the reserved bottom track. */
  baseLayer?: Pick<Layer, 'name' | 'visible' | 'locked' | 'outline' | 'outlineColor'>;
  openMotionTween?: OpenMotionTween;
  /** Library insertion preference; existing instance playback remains explicit. */
  defaultPlayback?: 'loop' | 'movie';
  multiFramePivot?: { x: number; y: number };
  buttonStates?: ButtonStates;
  timeline?: {
    duration: number;
    layerMasks?: Project['layerMasks'];
    /** Inactive TypeScript bodies owned by zero-based local frames, not button handlers. */
    frameScripts?: FrameScript[];
    frameLabels?: FrameLabel[];
    frameComments?: FrameComment[];
    keys: Keyframe[];
    layers?: Layer[];
    motionSpans?: BasicMotionSpan[];
  };
  id: string;
  name: string;
  width: number;
  height: number;
  shapes: Vector[];
};
/** Base artwork is the bottom track; additional tracks retain independent keys and metadata. */
export function symbolLayers(definition: SymbolDefinition): Layer[] {
  return [
    {
      id: '@base',
      name: definition.baseLayer?.name ?? 'Artwork',
      ...(definition.timeline?.motionSpans !== undefined
        ? { motionSpans: definition.timeline.motionSpans }
        : {}),
      visible: definition.baseLayer?.visible ?? true,
      locked: definition.baseLayer?.locked ?? false,
      ...(definition.baseLayer?.outline !== undefined ? {outline:definition.baseLayer.outline}:{}),
      ...(definition.baseLayer?.outlineColor !== undefined ? {outlineColor:definition.baseLayer.outlineColor}:{}),
      keys: [{ frame: 0, shapes: definition.shapes,
        ...(definition.openMotionTween ? { openMotionTween: definition.openMotionTween } : {}) },
      ...(definition.timeline?.keys ?? [])],
    },
    ...(definition.timeline?.layers ?? []),
  ];
}
export function symbolArtworks(definition: SymbolDefinition): Vector[][] {
  return symbolLayers(definition).flatMap((l) => l.keys.map((k) => k.shapes));
}
export function assertSymbolHasArtwork(layers: readonly Layer[]): void {
  if (!layers.some(layer => layer.keys.some(key => key.shapes.length > 0)))
    throw Error('Keep artwork on at least one frame of the symbol.');
}
export interface FrameScript { frame: number; source: string }
export type Project = {
  layerMasks?: {maskLayerId:string;layerIds:string[]}[];
  /** Optional non-rendering organization, independent of timeline layer folders. */
  libraryFolders?: LibraryFolder[];
  libraryLinks?: LibraryLink[];
  libraryItems?: LibraryLocation[];
  opacityBindings?: RootOpacityBinding[];
  /** TypeScript bodies owned by absolute main-timeline frames, independent of artwork keys. */
  frameScripts?: FrameScript[];
  frameLabels?: FrameLabel[];
  frameComments?: FrameComment[];
  /** Root-timeline audio references. File bytes are external assets; no automatic playback. */
  audioClips?: AudioClip[];
  multiFramePivot?: { x: number; y: number };
  symbols?: SymbolDefinition[];
  folders?: LayerFolder[];
  schemaVersion: 59 | 60 | 61;
  scenes?: SceneCatalog;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  duration: number;
  layers: Layer[];
  assets: Asset[];
  guides?: { id: string; axis: 'x' | 'y'; position: number }[];
};
export const id = () => crypto.randomUUID();
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function newLayer(name: string): Layer {
  return { id: id(), name, visible: true, locked: false, keys: [{ frame: 0, shapes: [] }] };
}
export function newProject(name = 'Untitled'): Project {
  return {
    schemaVersion: 59,
    id: id(),
    name,
    width: 960,
    height: 540,
    fps: 24,
    background: '#ffffff',
    duration: 48,
    layers: [newLayer('Layer 1')],
    assets: [],
  };
}
/** Keep guide geometry available to followers while suppressing its own movie paint and hits. */
export function movieLayerView(project: Project): Project {
  if (!project.layers.some(layer => layer.guideLayer && layer.visible)) return project;
  return { ...project, layers: project.layers.map(layer => layer.guideLayer && layer.visible
    ? { ...layer, visible: false } : layer) };
}
export function keyAt(layer: Layer, frame: number): Keyframe {
  return [...layer.keys].reverse().find((k) => k.frame <= frame) ?? layer.keys[0];
}
export function insertKey(layer: Layer, frame: number, blank = false): void {
  const existing = layer.keys.find((k) => k.frame === frame);
  if (existing) {
    if (blank) {
      existing.shapes = [];
      delete existing.openMotionTween;
    }
    return;
  }
  layer.keys.push({ frame, shapes: blank ? [] : clone(keyAt(layer, frame).shapes) });
  layer.keys.sort((a, b) => a.frame - b.frame);
}
export function safePath(path: string): string {
  if (
    !/^[a-zA-Z0-9_.\-/]+$/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((s) => !s || s === '.' || s === '..') ||
    path.includes(':')
  )
    throw new Error('Unsafe project-relative path');
  return path;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid project: ${message}`);
}
const validTint = (t: Tint) => t && typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) &&
  Number.isFinite(t.amount) && t.amount >= 0 && t.amount <= 1;
const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e7;
const color = (x: unknown) => typeof x === 'string' && /^#[\da-f]{6}$/i.test(x);
function validateOpenMotionTween(owner: Keyframe | SymbolDefinition) {
  const field = Object.getOwnPropertyDescriptor(owner, 'openMotionTween');
  if (!field && !('openMotionTween' in owner)) return;
  assert(field?.enumerable && 'value' in field, 'open motion tween');
  const settings = field.value;
  assert(settings && typeof settings === 'object' && Reflect.ownKeys(settings).length === 2,
    'open motion tween settings');
  const affine = Object.getOwnPropertyDescriptor(settings, 'affine');
  const ease = Object.getOwnPropertyDescriptor(settings, 'ease');
  assert(affine?.enumerable && 'value' in affine && typeof affine.value === 'boolean' &&
    ease?.enumerable && 'value' in ease, 'open motion tween settings');
  validateLiveMotionData(settings);
  validateMotionEase(ease.value);
}
function validateMultiFramePivot(pivot: Project['multiFramePivot']) {
  assert(
    pivot === undefined || (!!pivot && finite(pivot.x) && finite(pivot.y)),
    'multi-frame pivot',
  );
}
export function validateProject(input: unknown): Project {
  assert(input && typeof input === 'object', 'expected an object');
  const project = input as Project;
  validateSceneCatalog(project);
  validateDocument(project);
  if (project.scenes) {
    const activeOnly = { ...project };
    delete activeOnly.scenes;
    for (const entry of project.scenes.entries) {
      if (entry.data) validateDocument(projectWithSceneData(activeOnly, entry.data));
    }
  }
  return clone(project);
}
function validateDocument(input: unknown, references?: Set<string>): void {
  assert(input && typeof input === 'object', 'expected an object');
  const p = input as Project;
  validateLibraryOrganization(p);
  preflightLiveGraphicSource(p);
  assert(p.schemaVersion === 59 || p.schemaVersion === 60 || p.schemaVersion === 61, 'unsupported schema version');
  validateSavedLayerMasks(p);
  assert(!('restrictedArc' in p), 'restricted arc timing belongs to independent group bindings');
  assert(!('liveMotionSpans' in p), 'live motion spans belong to root layers');
  assert(
    typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 200,
    'identity',
  );
  assert(
    Number.isInteger(p.width) &&
      p.width > 0 &&
      p.width <= 8192 &&
      Number.isInteger(p.height) &&
      p.height > 0 &&
      p.height <= 8192,
    'stage dimensions',
  );
  assert(
    finite(p.fps) &&
      p.fps >= 1 &&
      p.fps <= 120 &&
      Number.isInteger(p.duration) &&
      p.duration >= 1 &&
      p.duration <= MAX_PROJECT_DURATION,
    'timing',
  );
  validateProjectFrameScripts(p);
  validateFrameLabels(readFrameLabels(p), p.duration);
  validateFrameComments(readFrameComments(p), p.duration);
  assert(color(p.background), 'background');
  validateMultiFramePivot(p.multiFramePivot);
  assert(
    p.symbols === undefined || (Array.isArray(p.symbols) && p.symbols.length <= 128),
    'symbol library',
  );
  const symbolIds = references ?? new Set<string>();
  let symbolShapes = 0;
  for (const symbol of p.symbols ?? []) {
    assert(
      symbol && typeof symbol.id === 'string' && !!symbol.id && !symbolIds.has(symbol.id),
      'symbol identity',
    );
    symbolIds.add(symbol.id);
  }
  for (const symbol of p.symbols ?? []) {
    assert(!('restrictedArc' in symbol) && (!symbol.timeline || !('restrictedArc' in symbol.timeline)), 'restricted arc timing belongs to root group bindings');
    const playback=Object.getOwnPropertyDescriptor(symbol,'defaultPlayback');
    assert((playback!==undefined||!('defaultPlayback'in symbol))&&(!playback||(playback.enumerable&&'value'in playback&&[undefined,'loop','movie'].includes(playback.value))), 'symbol default playback');
    assert(playback?.value!=='movie'||symbol.buttonStates===undefined,'button insertion cannot use movie playback');
    assert(
      typeof symbol.name === 'string' && !!symbol.name.trim() && symbol.name.length <= 200,
      'symbol name',
    );
    assert(
      finite(symbol.width) && finite(symbol.height) && symbol.width >= 0 && symbol.height >= 0,
      'symbol bounds',
    );
    assert(!('opacityBindings' in symbol), 'opacity bindings belong to the root document');
    validateOpenMotionTween(symbol);
    const baseMetadata=Object.getOwnPropertyDescriptor(symbol,'baseLayer');
    assert((baseMetadata!==undefined||!('baseLayer'in symbol))&&(!baseMetadata||(baseMetadata.enumerable&&'value'in baseMetadata)),'symbol base layer');
    if(baseMetadata?.value!==undefined){
      const b=baseMetadata.value;
      assert(b&&typeof b==='object'&&!Array.isArray(b)&&[Object.prototype,null].includes(Object.getPrototypeOf(b)),'symbol base layer');
      assert(Reflect.ownKeys(b).every(k=>typeof k==='string'&&['name','visible','locked','outline','outlineColor'].includes(k)&&Object.getOwnPropertyDescriptor(b,k)?.enumerable&&'value'in Object.getOwnPropertyDescriptor(b,k)!),'symbol base layer');
      assert(['name','visible','locked'].every(k=>Object.prototype.hasOwnProperty.call(b,k))&&typeof b.name==='string'&&!!b.name.trim()&&b.name.length<=80&&typeof b.visible==='boolean'&&typeof b.locked==='boolean','symbol base layer');
    }
    validateMultiFramePivot(symbol.multiFramePivot);
    assert(Array.isArray(symbol.shapes), 'symbol artwork');
    if (symbol.timeline !== undefined) {
      assert(symbol.timeline && typeof symbol.timeline === 'object', 'symbol timeline');
      assert(!('opacityBindings' in symbol.timeline), 'opacity bindings belong to the root document');
      assert(
        Number.isInteger(symbol.timeline.duration) &&
          symbol.timeline.duration >= 1 &&
          symbol.timeline.duration <= 10000,
        'symbol duration',
      );
      assert(
        Array.isArray(symbol.timeline.keys) &&
          symbol.timeline.keys.length <= 10000 &&
          symbol.timeline.keys.every((k) => k.frame > 0 && Array.isArray(k.shapes)),
        'symbol timeline keys',
      );
      assert(
        symbol.timeline.layers === undefined ||
          (Array.isArray(symbol.timeline.layers) && symbol.timeline.layers.length <= 127),
        'symbol layers',
      );
      for (const layer of symbol.timeline.layers ?? []) {
        assert(
          layer &&
            typeof layer.id === 'string' &&
            !!layer.id &&
            layer.id !== '@base' &&
            typeof layer.name === 'string' &&
            !!layer.name.trim() &&
            layer.name.length <= 80 &&
            layer.folderId === undefined &&
            Array.isArray(layer.keys) &&
            layer.keys.every((k) => Array.isArray(k.shapes)),
          'symbol layer',
        );
        const mode = Object.getOwnPropertyDescriptor(layer, 'drawingMode');
        assert(mode ? mode.enumerable && 'value' in mode &&
          (mode.value === undefined || mode.value === 'merge' || mode.value === 'object') : !('drawingMode' in layer),
        'symbol layer drawing mode');
      }
    }
    if (symbol.buttonStates !== undefined) {
      const states = symbol.buttonStates;
      assert(
        states && typeof states === 'object' && !Array.isArray(states),
        'button state mapping',
      );
      assert(
        Object.keys(states).length === 4 &&
          ['up', 'over', 'down', 'hit'].every(
            (name) =>
              Object.prototype.hasOwnProperty.call(states, name) &&
              Number.isInteger(states[name as keyof ButtonStates]) &&
              states[name as keyof ButtonStates] >= 0 &&
              states[name as keyof ButtonStates] < (symbol.timeline?.duration ?? 1),
          ),
        'button state frame',
      );
    }
    assert(!('liveMotionSpans' in symbol) && (!symbol.timeline || !('liveMotionSpans' in symbol.timeline)), 'live motion is root-only');
    assert(!('frameLabels' in symbol), 'symbol frame labels belong to its timeline');
    assert(!('frameComments' in symbol), 'symbol frame comments belong to its timeline');
    const tracks = symbolLayers(symbol);
    if (symbol.timeline && 'layerMasks' in symbol.timeline) {
      assert(p.schemaVersion >= 60, 'symbol timeline masks require schema 60');
      validateSavedLayerMasks(symbol.timeline, tracks);
    }
    assertSymbolHasArtwork(tracks);
    symbolShapes += symbolArtworks(symbol).reduce((n, shapes) => n + shapes.length, 0);
    assert(symbolShapes <= MAX_SYMBOL_ARTWORK, 'symbol artwork budget');
    validateDocument(
      {
        ...p,
        layerMasks: undefined,
        opacityBindings: undefined,
        frameScripts: undefined,
        frameLabels: readFrameLabels(symbol.timeline),
        frameComments: readFrameComments(symbol.timeline),
        audioClips: undefined,
        scenes: undefined,
        symbols: [],
        folders: [],
        libraryItems: undefined,
        duration: symbol.timeline?.duration ?? p.duration,
        layers: tracks,
      },
      symbolIds,
    );
  }
  // Validate the complete dependency graph, including hidden keys and unused definitions.
  const definitions = new Map((p.symbols ?? []).map((d) => [d.id, d]));
  const visiting = new Set<string>();
  const budgets = new Map<string, { depth: number; shapes: number; groups: number }>();
  function budget(id: string): { depth: number; shapes: number; groups: number } {
    assert(!visiting.has(id), 'nested symbol cycle');
    const cached = budgets.get(id);
    if (cached) return cached;
    const definition = definitions.get(id)!;
    visiting.add(id);
    let depth = 1,
      shapes = 0,
      groups = 0;
    for (const layer of symbolLayers(definition)) {
      let layerShapes = 0;
      for (const artwork of layer.keys.map((k) => k.shapes)) {
        let count = 0;
        for (const child of artwork) {
          const nested = child.kind === 'symbol' ? budget(child.symbolId!) : undefined;
          depth = Math.max(depth, 1 + (nested?.depth ?? 0));
          groups = Math.max(groups, (child.groups?.length ?? 0) + (nested?.groups ?? 0));
          count += nested?.shapes ?? 1;
          assert(count <= 100000 && depth <= 8 && groups <= 32, 'nested symbol expansion budget');
        }
        layerShapes = Math.max(layerShapes, count);
      }
      shapes += layerShapes;
      assert(shapes <= 100000, 'nested symbol expansion budget');
    }
    visiting.delete(id);
    const result = { depth, shapes, groups };
    budgets.set(id, result);
    return result;
  }
  for (const definition of p.symbols ?? []) budget(definition.id);
  assert(Array.isArray(p.layers) && p.layers.length > 0 && p.layers.length <= 1000, 'layers');
  assert(
    p.folders === undefined || (Array.isArray(p.folders) && p.folders.length <= 128),
    'layer folders',
  );
  const folders = new Map<string, LayerFolder>();
  for (const f of p.folders ?? []) {
    assert(
      typeof f.id === 'string' &&
        !!f.id &&
        !folders.has(f.id) &&
        typeof f.name === 'string' &&
        f.name.length > 0 &&
        f.name.length <= 80 &&
        (f.parentId === undefined || typeof f.parentId === 'string'),
      'folder metadata',
    );
    folders.set(f.id, f);
  }
  for (const f of folders.values()) {
    const seen = new Set<string>();
    let current: LayerFolder | undefined = f;
    while (current) {
      assert(!seen.has(current.id) && seen.size < 8, 'folder cycle or depth');
      seen.add(current.id);
      if (current.parentId === undefined) break;
      assert(folders.has(current.parentId), 'folder parent');
      current = folders.get(current.parentId);
    }
  }
  const layerIds = new Set<string>();
  for (const l of p.layers) {
    assert(!('restrictedArc' in l), 'restricted arc timing belongs to independent group bindings');
    assert(
      typeof l.id === 'string' &&
        !layerIds.has(l.id) &&
        typeof l.name === 'string' &&
        typeof l.visible === 'boolean' &&
        typeof l.locked === 'boolean',
      'layer metadata',
    );
    assert(l.outline === undefined || typeof l.outline === 'boolean', 'layer outline');
    assert(l.outlineColor === undefined || color(l.outlineColor), 'layer outline color');
    assert(!('opacityBindings' in l), 'opacity bindings belong to the root document');
    layerIds.add(l.id);
    if ('guideLayer' in l) {
      const role = Object.getOwnPropertyDescriptor(l, 'guideLayer');
      assert(!references && role?.enumerable && 'value' in role && role.value === true, 'root guide layer role');
      assert(!p.layerMasks?.some(mask => mask.maskLayerId === l.id || mask.layerIds.includes(l.id)), 'guide layers cannot participate in masks');
    }
    assert(!references || !('liveMotionSpans' in l), 'live motion is root-only');
    assert(l.motionSpans === undefined || Array.isArray(l.motionSpans), 'motion spans');
    const spanIds = new Set<string>();
    let spanEnd = -1;
    for (const span of l.motionSpans ?? []) {
      assert(!('guide' in span), 'linked guides belong to sparse live tweens');
      assert(!('groupPaths' in span), 'independent group paths belong to sparse live spans');
      assert(
        span &&
          typeof span.id === 'string' &&
          !!span.id &&
          !spanIds.has(span.id) &&
          Number.isInteger(span.start) &&
          Number.isInteger(span.end) &&
          span.start >= 0 &&
          span.end - span.start >= 2 &&
          span.end < 100000 &&
          span.start >= spanEnd &&
          typeof span.baseline === 'string',
        'basic motion span',
      );
      assert(
        span.autoRefresh === undefined || typeof span.autoRefresh === 'boolean',
        'motion automatic refresh',
      );
      validateMotionEase(span.ease);
      validatePositionTiming(span);
      if ('gradientColorTracks' in span) {
        const data=Object.getOwnPropertyDescriptor(span,'gradientColorTracks');
        assert(data?.enumerable && 'value' in data && span.options?.paint && !span.rotation?.rigidGroups,'gradient keys require individual paint interpolation');
        validateGradientColorTracks(data!.value,span.end-span.start);
      }
      for (const {field,option} of liveColorChannels) if (field in span) {
        const d=Object.getOwnPropertyDescriptor(span,field);
        assert(d?.enumerable && 'value' in d && span.options?.[option] && !span.rotation?.rigidGroups,'remembered color keys require explicit interpolation');
        validateLiveColorKeys(d!.value,span.end-span.start);
      }
      for (const {field} of liveNumericChannels) if (field in span) {
        if (field==='rotationKeys') assert(!span.path?.tangent && !span.rotation?.rigidGroups,'rotation keys require individually owned angles');
        if (field==='shearKeys' || field==='scaleXKeys' || field==='scaleYKeys') assert(span.options?.affine && !span.rotation?.rigidGroups,'scale keys require individual affine artwork');
        if (field==='xKeys' || field==='yKeys') assert(!span.path && !span.rotation?.rigidGroups,'position keys require path-free individual artwork');
        const d=Object.getOwnPropertyDescriptor(span,field);
        assert(d?.enumerable && 'value' in d,'original remembered opacity keys');
        validateLiveNumericKeys(d!.value,span.end-span.start,field);
      }
      if(span.opacityEase!==undefined)validateMotionEase(span.opacityEase);
      if(span.paintEase!==undefined){validateMotionEase(span.paintEase);assert(span.options?.paint===true,'independent paint easing requires paint interpolation');}
      validateMotionSpanOptions(span.options);
      if (span.path !== undefined) validateMotionPath(span.path);
      if (span.correspondence !== undefined)
        validateMotionContourCorrespondence(span.correspondence);
      if (span.rotation !== undefined) validateMotionRotation(span.rotation);
      // Stale spans remain loadable after timeline edits; refresh checks their exact generated keys.
      spanIds.add(span.id);
      spanEnd = span.end;
    }
    validateLiveMotionLayer(l, p.duration, p.opacityBindings);
    for (const span of l.liveMotionSpans ?? [])
      if (span.guide) resolveGuideArtwork(p.layers, l.id, span.guide);
    assert(
      l.folderId === undefined || (typeof l.folderId === 'string' && folders.has(l.folderId)),
      'layer folder reference',
    );
    assert(
      l.drawingMode === undefined || ['object', 'merge'].includes(l.drawingMode),
      'drawing mode',
    );
    assert(Array.isArray(l.keys) && l.keys.length > 0 && l.keys[0].frame === 0, 'initial keyframe');
    let previous = -1;
    for (const k of l.keys) {
      validateOpenMotionTween(k);
      assert(!('restrictedArc' in k), 'restricted arc timing belongs to independent group bindings');
      assert(
        Number.isInteger(k.frame) && k.frame > previous && k.frame < p.duration,
        'keyframe ordering',
      );
      previous = k.frame;
      assert(Array.isArray(k.shapes) && k.shapes.length <= 100000, 'shapes');
      const ids = new Set<string>();
      const groupParents = new Map<string, string>();
      for (const s of k.shapes) {
        assert(!('restrictedArc' in s), 'restricted arc timing belongs to independent group bindings');
        assert(typeof s.id === 'string' && !ids.has(s.id), 'shape identity');
        ids.add(s.id);
        if (s.transform !== undefined) {
          assert(
            Array.isArray(s.transform) &&
              s.transform.length === 4 &&
              s.transform.every((n) => finite(n) && Math.abs(n) <= 100000) &&
              Math.abs(s.transform[0] * s.transform[3] - s.transform[1] * s.transform[2]) >= 1e-10,
            'affine transform',
          );
        }
        if (s.pivot !== undefined)
          assert(
            finite(s.pivot.x) &&
              finite(s.pivot.y) &&
              Math.abs(s.pivot.x) <= 1e8 &&
              Math.abs(s.pivot.y) <= 1e8,
            'transform pivot',
          );
        if (s.groups !== undefined) {
          assert(
            Array.isArray(s.groups) &&
              s.groups.length <= 32 &&
              new Set(s.groups).size === s.groups.length,
            'group ancestry',
          );
          s.groups.forEach((group, index) => {
            assert(
              typeof group === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(group),
              'group identity',
            );
            const parent = JSON.stringify(s.groups!.slice(0, index));
            assert(!groupParents.has(group) || groupParents.get(group) === parent, 'group parent');
            groupParents.set(group, parent);
          });
          assert(l.drawingMode !== 'merge' || !s.groups.length, 'groups require object drawing');
        }
        assert(
          [
            'rectangle',
            'ellipse',
            'line',
            'path',
            'brush',
            'bezier',
            'polygon',
            'text',
            'symbol',
          ].includes(s.kind),
          'shape kind',
        );
        assert(
          [s.x, s.y, s.width, s.height, s.rotation, s.strokeWidth].every(finite) &&
            s.width >= 0 &&
            s.height >= 0 &&
            s.strokeWidth >= 0 &&
            s.strokeWidth <= 200,
          'shape geometry',
        );
        if ('controlBounds' in s) {
          const marker = Object.getOwnPropertyDescriptor(s, 'controlBounds');
          assert(marker?.enumerable && 'value' in marker && marker.value === true &&
            (s.kind === 'polygon' && Array.isArray(s.contours) && s.contours.length > 0 ||
              s.kind === 'bezier' && Array.isArray(s.nodes) && s.nodes.length > 0 ||
              s.kind === 'path' && Array.isArray(s.points) && s.points.length >= 2),
            'control bounds require explicit path geometry');
        }
        assert(color(s.fill) && color(s.stroke), 'paint');
        validateBoneBinding(s);
        validateBoneAttachment(s);
        assert(!s.bone || !s.boneAttachment, 'a bone cannot also be attached artwork');
        assert(
          s.kind === 'symbol'
            ? typeof s.symbolId === 'string' &&
                symbolIds.has(s.symbolId) &&
                l.drawingMode !== 'merge'
            : s.symbolId === undefined,
          'symbol reference',
        );
        if (!references && s.kind === 'symbol')
          assert(
            (s.groups?.length ?? 0) + budgets.get(s.symbolId!)!.groups <= 32,
            'nested symbol group budget',
          );
        if (s.instanceName !== undefined)
          assert(
            s.kind === 'symbol' &&
              typeof s.instanceName === 'string' &&
              s.instanceName.trim().length > 0 &&
              s.instanceName.length <= 200,
            'symbol instance name',
          );
        if (s.symbolPlayback !== undefined)
          assert(
            s.kind === 'symbol' &&
              s.symbolPlayback &&
              ['loop', 'once', 'single', 'movie'].includes(s.symbolPlayback.mode) &&
              Number.isInteger(s.symbolPlayback.firstFrame) &&
              s.symbolPlayback.firstFrame >= 0 &&
              s.symbolPlayback.firstFrame < 10000,
            'symbol playback',
          );
        if (s.symbolPlayback && 'keyframeCut' in s.symbolPlayback) {
          const cut = Object.getOwnPropertyDescriptor(s.symbolPlayback, 'keyframeCut');
          assert(cut?.enumerable && 'value' in cut && cut.value === true &&
            s.symbolPlayback.mode !== 'movie', 'graphic playback keyframe cut');
        }

        if (s.gradient) {
          const g = s.gradient;
          assert(
            ['linear', 'radial'].includes(g.kind) &&
              [g.from, g.to].every((p) => p && finite(p.x) && finite(p.y)) &&
              (g.transform === undefined ||
                (Array.isArray(g.transform) &&
                  g.transform.length === 4 &&
                  g.transform.every((v) => finite(v) && Math.abs(v) <= 100) &&
                  Math.abs(g.transform[0] * g.transform[3] - g.transform[1] * g.transform[2]) >=
                    0.000001)) &&
              Array.isArray(g.stops) &&
              g.stops.length >= 2 &&
              g.stops.length <= 32 &&
              g.stops.every(
                (stop, i) =>
                  finite(stop.offset) &&
                  stop.offset >= 0 &&
                  stop.offset <= 1 &&
                  color(stop.color) &&
                  (stop.opacity === undefined ||
                    (finite(stop.opacity) && stop.opacity >= 0 && stop.opacity <= 1)) &&
                  (i === 0 || stop.offset >= g.stops[i - 1].offset),
              ),
            'gradient',
          );
        }
        assert(
          s.drawingMode === undefined || ['object', 'merge'].includes(s.drawingMode),
          'shape mode',
        );
        assert(
          s.fillRule === undefined || ['nonzero', 'evenodd'].includes(s.fillRule),
          'fill rule',
        );
        assert(
          s.contours === undefined ||
            (Array.isArray(s.contours) &&
              s.contours.length <= 10000 &&
              s.contours.every(
                (r) =>
                  Array.isArray(r) &&
                  r.length >= 3 &&
                  r.length <= 100000 &&
                  r.every(
                    (p) =>
                      finite(p.x) &&
                      finite(p.y) &&
                      [p.in, p.out].every(
                        (h) => h === undefined || (h !== null && finite(h.x) && finite(h.y)),
                      ),
                  ),
              )),
          'polygon contours',
        );
        if (s.contours?.some((r) => r.some((n) => n.in || n.out)))
          assert(s.kind === 'polygon' && s.fillRule === 'evenodd', 'curved compound fill rule');
        assert(s.fillEnabled === undefined || typeof s.fillEnabled === 'boolean', 'fill enabled');
        assert(s.groupBlur === undefined || (s.groupBlur && typeof s.groupBlur.group === 'string' &&
          /^[a-zA-Z0-9_-]{1,100}$/.test(s.groupBlur.group) && Number.isInteger(s.groupBlur.radius) &&
          (s.groupBlur.blendMode === undefined || isBlendMode(s.groupBlur.blendMode)) &&
          (s.groupBlur.tint === undefined || validTint(s.groupBlur.tint)) &&
          s.groupBlur.radius >= (s.groupBlur.blendMode || s.groupBlur.tint ? 0 : 1) && s.groupBlur.radius <= 32 && s.kind !== 'symbol' && s.kind !== 'text'), 'group blur');
        assert(s.instanceTint === undefined || (s.kind === 'symbol' && validTint(s.instanceTint)), 'symbol tint');
        assert(s.tint === undefined || (s.kind !== 'symbol' && s.kind !== 'text' && !s.brush?.opacityProfile && validTint(s.tint)), 'drawing tint');
        assert(s.instanceBlend === undefined || (s.kind === 'symbol' &&
          isBlendMode(s.instanceBlend)), 'symbol blend mode');
        assert(s.instanceBlur === undefined || (s.kind === 'symbol' && Number.isInteger(s.instanceBlur) &&
          s.instanceBlur >= 1 && s.instanceBlur <= 32), 'symbol blur radius');
        assert(s.blendMode === undefined || (isBlendMode(s.blendMode) && s.kind !== 'text' &&
          s.kind !== 'symbol' && !s.brush?.opacityProfile), 'drawing blend mode');
        assert(s.blurRadius === undefined || (Number.isInteger(s.blurRadius) && s.blurRadius >= 1 && s.blurRadius <= 32 &&
          s.kind !== 'text' && s.kind !== 'symbol' && !s.brush?.opacityProfile), 'drawing blur radius');
        assert(s.paintBrightness === undefined || (s.kind !== 'symbol' && finite(s.paintBrightness) &&
          Math.abs(s.paintBrightness) <= 1), 'paint brightness');
        assert(s.closed === undefined || typeof s.closed === 'boolean', 'closed path');
        assert(
          s.opacity === undefined || (finite(s.opacity) && s.opacity >= 0 && s.opacity <= 1),
          'opacity',
        );
        assert(
          s.cornerRadius === undefined || (finite(s.cornerRadius) && s.cornerRadius >= 0),
          'corner radius',
        );
        assert(
          s.strokeCap === undefined || ['butt', 'round', 'square'].includes(s.strokeCap),
          'stroke cap',
        );
        assert(
          s.strokeJoin === undefined || ['round', 'bevel', 'miter'].includes(s.strokeJoin),
          'stroke join',
        );
        if (s.kind === 'brush') {
          const b = s.brush;
          assert(
            b &&
              (b.response === undefined ||
                (finite(b.response) && b.response >= 0.25 && b.response <= 4)) &&
              (b.opacityProfile === undefined ||
                (b.opacityProfile &&
                  finite(b.opacityProfile.minimum) &&
                  b.opacityProfile.minimum >= 0 &&
                  b.opacityProfile.minimum <= 1 &&
                  finite(b.opacityProfile.response) &&
                  b.opacityProfile.response >= 0.25 &&
                  b.opacityProfile.response <= 4)) &&
              typeof b.pressure === 'boolean' &&
              (b.twist === undefined || typeof b.twist === 'boolean') &&
              typeof b.tilt === 'boolean' &&
              finite(b.minimum) &&
              b.minimum >= 0.01 &&
              b.minimum <= 1 &&
              finite(b.aspect) &&
              b.aspect >= 0.1 &&
              b.aspect <= 1 &&
              finite(b.angle),
            'brush settings',
          );
        }
        if (s.kind === 'bezier') {
          assert(
            Array.isArray(s.nodes) &&
              s.nodes.length > 0 &&
              s.nodes.length <= 100000 &&
              s.nodes.every((n) =>
                [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])].every(
                  (p) => finite(p.x) && finite(p.y),
                ),
              ),
            'Bezier nodes',
          );
        }
        validateDynamicTextBinding(s.kind, s.text);
        if (s.kind === 'text') {
          const t = s.text;
          assert(
            t &&
              typeof t.content === 'string' &&
              t.content.length <= 10000 &&
              typeof t.font === 'string' &&
              /^[a-zA-Z0-9 ,_-]{1,100}$/.test(t.font) &&
              finite(t.size) &&
              t.size >= 1 &&
              t.size <= 1000 &&
              typeof t.bold === 'boolean' &&
              typeof t.italic === 'boolean' &&
              [t.scaleX, t.scaleY].every(
                (n) => n === undefined || (finite(n) && n >= 0 && n <= 100000),
              ) &&
              (t.lineHeight === undefined ||
                (finite(t.lineHeight) && t.lineHeight >= 0.5 && t.lineHeight <= 5)) &&
              (t.direction === undefined || ['ltr', 'rtl'].includes(t.direction)) &&
              (t.kerning === undefined || ['auto', 'normal', 'none'].includes(t.kerning)) &&
              (t.wordSpacing === undefined ||
                (finite(t.wordSpacing) && t.wordSpacing >= -20 && t.wordSpacing <= 200)) &&
              (t.letterSpacing === undefined ||
                (finite(t.letterSpacing) && t.letterSpacing >= -20 && t.letterSpacing <= 200)) &&
              (t.wrapWidth === undefined ||
                (finite(t.wrapWidth) && t.wrapWidth >= 0 && t.wrapWidth <= 100000)) &&
              ['left', 'center', 'right'].includes(t.align),
            'text',
          );
          if (t.runs !== undefined) {
            assert(Array.isArray(t.runs), 'text runs');
            canonicalTextRuns(t.content, t.runs);
          }
        }
        assert(
          Array.isArray(s.points) &&
            s.points.length <= MAX_VECTOR_POINTS &&
            s.points.every(
              (pt) =>
                finite(pt.x) &&
                finite(pt.y) &&
                (pt.pressure === undefined ||
                  (finite(pt.pressure) && pt.pressure >= 0 && pt.pressure <= 1)) &&
                (pt.tiltX === undefined || (finite(pt.tiltX) && Math.abs(pt.tiltX) <= 90)) &&
                (pt.tiltY === undefined || (finite(pt.tiltY) && Math.abs(pt.tiltY) <= 90)) &&
                (pt.twist === undefined || (finite(pt.twist) && pt.twist >= 0 && pt.twist <= 359)),
            ),
          'path points',
        );
      }
      const closedGroups = new Set<string>();
      let ancestry: string[] = [];
      for (const shape of k.shapes) {
        const next = shape.groups ?? [];
        let shared = 0;
        while (shared < ancestry.length && ancestry[shared] === next[shared]) shared++;
        ancestry.slice(shared).forEach((group) => closedGroups.add(group));
        next
          .slice(shared)
          .forEach((group) =>
            assert(!closedGroups.has(group) && !ids.has(group), 'group stacking'),
          );
        ancestry = next;
      }
    }
  }
  assert(
    Array.isArray(p.assets) &&
      p.assets.every((a) => typeof a.id === 'string' && typeof a.path === 'string'),
    'assets',
  );
  const assetIds = new Set<string>(),
    assetPaths = new Set<string>(),
    fontFamilies = new Set<string>();
  let bitmapBytes = 0, audioPcmBytes=0, fontBytes=0;
  assert(p.assets.length <= 10000, 'asset count');
  p.assets.forEach((a) => {
    assert(!assetIds.has(a.id) && !assetPaths.has(a.path), 'duplicate asset');
    assetIds.add(a.id);
    assetPaths.add(a.path);
    safePath(a.path);
    assert(a.path.startsWith('assets/'), 'asset location');
    assert([a.audio,a.bitmap,a.font].filter(value=>value!==undefined).length<=1,'ambiguous asset type');
    if (a.font !== undefined) {
      assert(a.path.startsWith('assets/fonts/') && a.path.endsWith('.json'), 'font location');
      validateEmbeddedFont(a.font);
      const family = a.font.family.toLowerCase();
      assert(!fontFamilies.has(family), 'duplicate embedded font family');
      fontFamilies.add(family);
      fontBytes += a.font.bytes;
      assert(fontBytes <= EMBEDDED_FONT_PROJECT_BYTES, 'embedded font project budget');
    }
    if(a.audio!==undefined){
      const audio=a.audio;
      assert(audio&&typeof audio==='object'&&!Array.isArray(audio)&&typeof audio.name==='string'&&audio.name.length>0&&audio.name.length<=200&&audio.format==='pcm16-wav','audio identity/format');
      assert(a.path.startsWith('assets/audio/')&&a.path.endsWith('.wav'),'audio location');
      assert(Number.isInteger(audio.sampleRate)&&audio.sampleRate>=8000&&audio.sampleRate<=192000&&(audio.channels===1||audio.channels===2)&&Number.isSafeInteger(audio.frames)&&audio.frames>0,'audio metadata');
      audioPcmBytes+=audio.frames*audio.channels*4;
      assert(Number.isSafeInteger(audioPcmBytes)&&audioPcmBytes<=128*1024*1024,'audio project PCM budget');
    }
    if (a.bitmap !== undefined) {
      const b = a.bitmap;
      assert(
        b && typeof b.name === 'string' && b.name.length > 0 && b.name.length <= 200,
        'bitmap name',
      );
      assert(
        Number.isInteger(b.width) &&
          Number.isInteger(b.height) &&
          b.width > 0 &&
          b.height > 0 &&
          b.width <= 4096 &&
          b.height <= 4096 &&
          b.width * b.height <= 16000000,
        'bitmap dimensions',
      );
      assert(a.path.startsWith('assets/bitmaps/') && a.path.endsWith('.json'), 'bitmap location');
      if (b.dataUrl !== undefined) {
        assert(
          typeof b.dataUrl === 'string' &&
            b.dataUrl.length <= 2800000 &&
            /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(b.dataUrl),
          'bitmap PNG payload',
        );
        const header = atob(b.dataUrl.slice(22, 66));
        const dimension = (offset: number) =>
          Array.from(header.slice(offset, offset + 4)).reduce(
            (n, c) => n * 256 + c.charCodeAt(0),
            0,
          );
        assert(
          header.slice(12, 16) === 'IHDR' &&
            dimension(16) === b.width &&
            dimension(20) === b.height,
          'bitmap PNG dimensions',
        );
        bitmapBytes += b.dataUrl.length;
      }
    }
  });
  assert(bitmapBytes <= 8000000, 'bitmap project budget');
  validateAudioClips(p.audioClips,p.duration,p.assets);
  const bitmapReferences = new Set<string>();
  for (const s of [
    ...p.layers.flatMap((l) => l.keys.flatMap((k) => k.shapes)),
    ...(p.symbols ?? []).flatMap((s) => symbolArtworks(s).flat()),
  ])
    if (s.bitmap) {
      const b = s.bitmap;
      bitmapReferences.add(b.assetId);
      assert(
        !s.gradient &&
          typeof b.assetId === 'string' &&
          p.assets.some((a) => a.id === b.assetId && a.bitmap),
        'bitmap fill reference',
      );
      assert(
        [b.x, b.y, b.width, b.height].every(finite) &&
          Math.abs(b.x) <= 100000 &&
          Math.abs(b.y) <= 100000 &&
          b.width > 0 &&
          b.height > 0 &&
          b.width <= 100000 &&
          b.height <= 100000 &&
          (b.repeat === undefined || typeof b.repeat === 'boolean'),
        'bitmap fill mapping',
      );
      if (b.transform !== undefined) {
        assert(
          Array.isArray(b.transform) &&
            b.transform.length === 4 &&
            b.transform.every((n) => finite(n) && Math.abs(n) <= 100),
          'bitmap fill transform',
        );
        const [a, c, d, e] = b.transform;
        assert(Math.abs(a * e - c * d) >= 1e-6, 'singular bitmap fill transform');
      }
    }
  assert(
    p.assets
      .filter((a) => bitmapReferences.has(a.id))
      .reduce((sum, a) => sum + (a.bitmap?.width ?? 0) * (a.bitmap?.height ?? 0), 0) <= 32000000,
    'referenced bitmap pixel budget',
  );
  if (p.guides !== undefined) {
    assert(Array.isArray(p.guides) && p.guides.length <= 1000, 'guides');
    const guideIds = new Set<string>();
    p.guides.forEach((g) => {
      assert(
        typeof g.id === 'string' &&
          !guideIds.has(g.id) &&
          ['x', 'y'].includes(g.axis) &&
          finite(g.position) &&
          Math.abs(g.position) <= 100000,
        'guide',
      );
      guideIds.add(g.id);
    });
  }
  if(p.opacityBindings!==undefined)prepareRootOpacityBindings(p,p.opacityBindings);
}
function clearLegacySpanRefresh(project: Project): void {
  for (const layer of project.layers ?? [])
    for (const span of layer.motionSpans ?? []) delete span.autoRefresh;
  for (const symbol of project.symbols ?? [])
    for (const layer of symbolLayers(symbol))
      for (const span of layer.motionSpans ?? []) delete span.autoRefresh;
}
/** v0 was an internal flat prototype, never a published .spl format. */
export function migrateProject(value: unknown): Project {
  if(value&&typeof value==='object'&&'schemaVersion'in value&&typeof value.schemaVersion==='number'&&value.schemaVersion<=58){
    if('symbols'in value&&Array.isArray(value.symbols)&&value.symbols.some(s=>s&&typeof s==='object'&&'baseLayer'in s))throw Error('Symbol base layer metadata requires schema 59.');
    if(value.schemaVersion===58)return validateProject({...value,schemaVersion:59});
  }
  if(value&&typeof value==='object'&&'schemaVersion'in value&&typeof value.schemaVersion==='number'&&value.schemaVersion<=57){
    if('layerMasks'in value)throw Error('Saved layer masks require schema 58.');
    if(value.schemaVersion===57)return validateProject({...value,schemaVersion:59});
  }

  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=56){
    rejectUnversionedRestrictedArcs(value);
    if(value.schemaVersion===56)return validateProject({...value,schemaVersion:59});
  }

  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=55){
    const layers=Object.getOwnPropertyDescriptor(value,'layers');
    if(layers && 'value' in layers && Array.isArray(layers.value))for(const layer of layers.value){
      const spans=layer&&Object.getOwnPropertyDescriptor(layer,'liveMotionSpans');
      if(spans && 'value' in spans && Array.isArray(spans.value))for(const span of spans.value)if(span&&typeof span==='object'&&'groupPaths' in span)throw Error('Independent group paths require schema 56.');
    }
    if(value.schemaVersion===55)return validateProject({...value,schemaVersion: 59});
  }

  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=54){
    const symbols='symbols' in value && Array.isArray(value.symbols)?value.symbols:[];
    for(const symbol of symbols){
      if(symbol && typeof symbol==='object' && symbol.timeline && typeof symbol.timeline==='object' && 'frameScripts' in symbol.timeline)
        throw new Error('Symbol frame scripts require schema 55.');
    }
    if(value.schemaVersion===54)return validateProject({...value,schemaVersion: 59});
  }
  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=53) {
    const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
    const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
    const root=record(value), owners=[root,...list(root.layers)];
    for(const symbol of list(root.symbols)){const definition=record(symbol),timeline=record(definition.timeline); owners.push(definition,timeline,...list(timeline.layers));}
    if(owners.some(owner=>'liveMotionSpans' in record(owner)))throw new Error('Live motion requires schema 54.');
    if(value.schemaVersion===53)return validateProject({...value,schemaVersion: 59});
  }

  if(value&&typeof value==='object'&&'schemaVersion' in value&&typeof value.schemaVersion==='number'&&value.schemaVersion<=52){
    const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
    const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
    const root=record(value),tracks=[...list(root.layers)];
    for(const symbol of list(root.symbols)){const timeline=record(record(symbol).timeline);tracks.push(timeline,...list(timeline.layers));}
    for(const track of tracks)for(const span of list(record(track).motionSpans))
      if('paintEase' in record(span))throw new Error('Independent paint easing requires schema 53.');
    if(value.schemaVersion===52)return validateProject({...value,schemaVersion: 59});
  }

  if(value&&typeof value==='object'&&'schemaVersion' in value&&typeof value.schemaVersion==='number'&&value.schemaVersion<=51){
    const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
    const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
    const root=record(value),tracks=[...list(root.layers)];
    for(const symbol of list(root.symbols)){const timeline=record(record(symbol).timeline);tracks.push(timeline,...list(timeline.layers));}
    for(const track of tracks)for(const span of list(record(track).motionSpans))
      if('opacityEase' in record(span))throw new Error('Independent opacity easing requires schema 52.');
    if(value.schemaVersion===51)return validateProject({...value,schemaVersion: 59});
  }

  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=50){
    const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
    const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
    const root=record(value),tracks=[...list(root.layers)];
    for(const symbol of list(root.symbols)){const timeline=record(record(symbol).timeline);tracks.push(timeline,...list(timeline.layers));}
    for(const track of tracks)for(const span of list(record(track).motionSpans)){
      const path=record(record(span).path);
      if(path.curvedWaypoints===true && path.distance===true && ('headingOffset' in path || 'headingOffsetEnd' in path))
        throw new Error('Distance-timed curved heading correction requires schema 51.');
    }
    if(value.schemaVersion===50)return validateProject({...value,schemaVersion: 59});
  }
  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=49){
    const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
    const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
    const root=record(value),tracks=[...list(root.layers)];
    for(const symbol of list(root.symbols)){const timeline=record(record(symbol).timeline);tracks.push(timeline,...list(timeline.layers));}
    for(const track of tracks)for(const span of list(record(track).motionSpans)){
      const path=record(record(span).path);
      if(path.curvedWaypoints===true && ('headingOffset' in path || 'headingOffsetEnd' in path))
        throw new Error('Curved waypoint heading correction requires schema 50.');
    }
    if(value.schemaVersion===49)return validateProject({...value,schemaVersion: 59});
  }
  if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion<=48){
    const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
    const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
    const root=record(value), tracks=[...list(root.layers)];
    for(const symbol of list(root.symbols)){const timeline=record(record(symbol).timeline);tracks.push(timeline,...list(timeline.layers));}
    for(const track of tracks)for(const span of list(record(track).motionSpans)){
      const path=record(record(span).path);
      if(path.waypoints !== undefined && ('headingOffset' in path || 'headingOffsetEnd' in path))throw new Error('Waypoint heading correction requires schema 49.');
      if(value.schemaVersion<=47 && path.distance === true && ('headingOffset' in path || 'headingOffsetEnd' in path))throw new Error('Distance-timed heading correction requires schema 48.');
      if(value.schemaVersion<=45 && 'source' in record(record(span).correspondence))throw new Error('Source contour alignment requires schema 46.');
      if(value.schemaVersion<=44 && 'headingOffsetEnd' in path)throw new Error('Linear tangent heading correction requires schema 45.');
      if(value.schemaVersion<=43 && 'headingOffset' in path)throw new Error('Tangent heading correction requires schema 44.');
    }
    if(value.schemaVersion===48 || value.schemaVersion===47)return validateProject({...value,schemaVersion: 59});
    if('opacityBindings' in value)throw new Error('Root opacity bindings require schema 47.');
    if(value.schemaVersion>=43 && Number.isInteger(value.schemaVersion))return validateProject({...value,schemaVersion: 59});
  }
  if(value&&typeof value==='object'&&'schemaVersion' in value&&typeof value.schemaVersion==='number'&&value.schemaVersion<=42){
    if('audioClips' in value&&Array.isArray(value.audioClips)&&value.audioClips.some(c=>c&&typeof c==='object'&&('fadeInSamples' in c||'fadeOutSamples' in c)))throw new Error('Audio fades require schema 43.');
    if(value.schemaVersion===42)return validateProject({...value,schemaVersion: 59});
  }
  if(value&&typeof value==='object'&&'schemaVersion' in value&&typeof value.schemaVersion==='number'&&value.schemaVersion<=41){
    if('audioClips' in value||('assets' in value&&Array.isArray(value.assets)&&value.assets.some(a=>a&&typeof a==='object'&&'audio' in a)))throw new Error('Audio references require schema 42.');
    if(value.schemaVersion===41)return validateProject({...value,schemaVersion: 59});
  }

  if(value && typeof value==='object' && 'schemaVersion' in value &&
    typeof value.schemaVersion==='number' && value.schemaVersion<=40 && 'frameScripts' in value)
    throw new Error('Frame scripts require schema 41.');
  if(value && typeof value==='object' && 'schemaVersion' in value && value.schemaVersion===40)
    return validateProject({...value,schemaVersion: 59});
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 39
  ) {
    const legacy = value as Project;
    const tracks = [...(legacy.layers ?? []), ...(legacy.symbols ?? []).flatMap(symbolLayers)];
    for (const track of tracks)
      for (const span of track.motionSpans ?? [])
        if (
          span.correspondence &&
          Object.keys(span.correspondence).some(
            (key) => !['start', 'reverse', 'order'].includes(key),
          )
        )
          throw new Error('Invalid schema 39 contour correspondence.');
    return validateProject({ ...legacy, schemaVersion: 59 });
  }
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion >= 0 &&
    value.schemaVersion <= 38
  ) {
    // Preserve original numeric values while removing formerly ignored recipe data.
    const clean = structuredClone(value) as Project;
    for (const layer of clean.layers ?? [])
      for (const span of layer.motionSpans ?? []) delete span.correspondence;
    for (const symbol of clean.symbols ?? [])
      for (const layer of symbolLayers(symbol))
        for (const span of layer.motionSpans ?? []) delete span.correspondence;
    if (value.schemaVersion === 38) return validateProject({ ...clean, schemaVersion: 59 });
    return migrateLegacyProject(clean);
  }
  return migrateLegacyProject(value);
}
function migrateLegacyProject(value: unknown): Project {
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion >= 31 &&
    value.schemaVersion <= 37
  ) {
    const legacy = value as Project;
    for (const layer of legacy.layers ?? [])
      for (const span of layer.motionSpans ?? [])
        validateMotionSpanOptions(
          span.options,
          value.schemaVersion >= 36,
          value.schemaVersion === 37,
          false,
        );
    for (const symbol of legacy.symbols ?? [])
      for (const layer of symbolLayers(symbol))
        for (const span of layer.motionSpans ?? [])
          validateMotionSpanOptions(
            span.options,
            value.schemaVersion >= 36,
            value.schemaVersion === 37,
            false,
          );
    if (value.schemaVersion >= 35) return validateProject({ ...legacy, schemaVersion: 59 });
  }

  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 34
  ) {
    const upgraded = clone({ ...value, schemaVersion: 59 }) as Project;
    clearLegacySpanRefresh(upgraded);
    return validateProject(upgraded);
  }

  // Older schemas required preset strings; do not reinterpret formerly invalid recipes.
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion >= 29 &&
    value.schemaVersion <= 33
  ) {
    const legacy = value as Project;
    const layers = [
      ...(legacy.layers ?? []),
      ...(legacy.symbols ?? []).flatMap((symbol) =>
        value.schemaVersion === 29 ? (symbol.timeline?.layers ?? []) : symbolLayers(symbol),
      ),
    ];
    for (const layer of layers)
      for (const span of layer.motionSpans ?? [])
        assert(
          ['linear', 'in', 'out', 'in-out'].includes(span.ease as string),
          'legacy motion easing',
        );
    if (value.schemaVersion === 33) {
      const upgraded = clone({ ...legacy, schemaVersion: 59 }) as Project;
      clearLegacySpanRefresh(upgraded);
      return validateProject(upgraded);
    }
  }

  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 32
  ) {
    const upgraded = clone({ ...value, schemaVersion: 59 }) as Project;
    clearLegacySpanRefresh(upgraded);
    for (const layer of upgraded.layers ?? [])
      for (const span of layer.motionSpans ?? []) delete span.rotation;
    for (const symbol of upgraded.symbols ?? [])
      for (const layer of symbolLayers(symbol))
        for (const span of layer.motionSpans ?? []) delete span.rotation;
    return validateProject(upgraded);
  }

  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 31
  ) {
    const upgraded = clone({ ...value, schemaVersion: 59 }) as Project;
    clearLegacySpanRefresh(upgraded);
    for (const layer of upgraded.layers ?? [])
      for (const span of layer.motionSpans ?? []) {
        delete span.path;
        delete span.rotation;
      }
    for (const symbol of upgraded.symbols ?? [])
      for (const layer of symbolLayers(symbol))
        for (const span of layer.motionSpans ?? []) {
          delete span.path;
          delete span.rotation;
        }
    return validateProject(upgraded);
  }

  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 30
  ) {
    const upgraded = clone({ ...value, schemaVersion: 59 }) as Project;
    clearLegacySpanRefresh(upgraded);
    for (const layer of upgraded.layers ?? [])
      for (const span of layer.motionSpans ?? []) {
        delete span.options;
        delete span.path;
        delete span.rotation;
      }
    for (const symbol of upgraded.symbols ?? [])
      for (const layer of symbolLayers(symbol))
        for (const span of layer.motionSpans ?? []) {
          delete span.options;
          delete span.path;
          delete span.rotation;
        }
    return validateProject(upgraded);
  }

  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 29
  ) {
    const upgraded = clone({ ...value, schemaVersion: 59 }) as Project;
    clearLegacySpanRefresh(upgraded);
    for (const layer of upgraded.layers ?? [])
      for (const span of layer.motionSpans ?? []) {
        delete span.options;
        delete span.path;
        delete span.rotation;
      }
    for (const symbol of upgraded.symbols ?? []) {
      if (symbol.timeline) delete symbol.timeline.motionSpans;
      for (const layer of symbol.timeline?.layers ?? [])
        for (const span of layer.motionSpans ?? []) {
          delete span.options;
          delete span.path;
          delete span.rotation;
        }
    }
    return validateProject(upgraded);
  }

  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 28
  ) {
    const upgraded = clone({ ...value, schemaVersion: 59 }) as Project;
    clearLegacySpanRefresh(upgraded);
    for (const layer of upgraded.layers ?? []) delete layer.motionSpans;
    for (const symbol of upgraded.symbols ?? []) {
      if (symbol.timeline) delete symbol.timeline.motionSpans;
      for (const layer of symbol.timeline?.layers ?? []) delete layer.motionSpans;
    }
    return validateProject(upgraded);
  }
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    (value.schemaVersion === 0 ||
      value.schemaVersion === 1 ||
      value.schemaVersion === 2 ||
      value.schemaVersion === 3 ||
      value.schemaVersion === 4 ||
      value.schemaVersion === 5 ||
      value.schemaVersion === 6 ||
      value.schemaVersion === 7 ||
      value.schemaVersion === 8 ||
      value.schemaVersion === 9 ||
      value.schemaVersion === 10 ||
      value.schemaVersion === 11 ||
      value.schemaVersion === 12 ||
      value.schemaVersion === 13 ||
      value.schemaVersion === 14 ||
      value.schemaVersion === 15 ||
      value.schemaVersion === 16 ||
      value.schemaVersion === 17 ||
      value.schemaVersion === 18 ||
      value.schemaVersion === 19 ||
      value.schemaVersion === 20 ||
      value.schemaVersion === 21 ||
      value.schemaVersion === 22 ||
      value.schemaVersion === 23 ||
      value.schemaVersion === 24 ||
      value.schemaVersion === 25 ||
      value.schemaVersion === 26 ||
      value.schemaVersion === 27)
  ) {
    const upgraded = clone({
      ...value,
      schemaVersion: 59,
      assets: 'assets' in value ? value.assets : [],
    }) as Project;
    for (const layer of upgraded.layers ?? []) delete layer.motionSpans;
    for (const symbol of upgraded.symbols ?? []) {
      if (symbol.timeline) delete symbol.timeline.motionSpans;
      for (const layer of symbol.timeline?.layers ?? []) delete layer.motionSpans;
    }
    delete upgraded.multiFramePivot;
    if (Array.isArray(upgraded.symbols))
      for (const symbol of upgraded.symbols)
        if (symbol && typeof symbol === 'object') delete symbol.multiFramePivot;
    // Legacy contours were straight; never activate formerly ignored handles.
    if (value.schemaVersion < 19 && Array.isArray(upgraded.layers))
      for (const layer of upgraded.layers)
        if (Array.isArray(layer?.keys))
          for (const key of layer.keys)
            if (Array.isArray(key?.shapes))
              for (const shape of key.shapes)
                if (Array.isArray(shape?.contours))
                  for (const ring of shape.contours)
                    if (Array.isArray(ring))
                      for (const node of ring)
                        if (node && typeof node === 'object') {
                          delete node.in;
                          delete node.out;
                        }
    return validateProject(upgraded);
  }
  return validateProject(value);
}
export class History {
  private revision = 0;
  private past: HistoryEntry<Project>[] = [];
  private future: HistoryEntry<Project>[] = [];
  private notice = '';

  constructor(private readonly byteLimit = HISTORY_BYTE_LIMIT) {
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) throw Error('Invalid Undo history byte budget.');
  }

  get undoLabel() { return this.past.at(-1)?.label; }
  get redoLabel() { return this.future.at(-1)?.label; }
  get retainedBytes() { return historyBytes(this.past) + historyBytes(this.future); }
  get retentionNotice() { return this.notice; }

  /** Encode the detached before-image before final admission. Publication only updates history. */
  prepareRecord(before: Project | HistoryCapture<Project>, label: string) {
    const revision = this.revision;
    const snapshot = new HistoryEntry(before, label);
    const past = appendHistory(this.past, snapshot, this.byteLimit, 100);
    const notice = snapshot.bytes > this.byteLimit ? 'An edit was too large to undo.' :
      historyBytes(this.past) + snapshot.bytes > this.byteLimit
        ? 'Older Undo history was trimmed.' : this.notice;
    if (this.revision !== revision) throw Error('History changed while preparing its before-image.');
    let used = false;
    return () => {
      if (used || this.revision !== revision) throw Error('Prepared history is stale.');
      used = true;
      this.revision++;
      this.past = past;
      this.future = [];
      this.notice = notice;
    };
  }

  record(before: Project | HistoryCapture<Project>, label: string) { this.prepareRecord(before, label)(); }
  undo(current: Project) { return this.restore(current, false)?.project; }
  redo(current: Project) { return this.restore(current, true)?.project; }

  /** Return the detached project and its existing recovery JSON from the same history entry. */
  restore(current: Project, redo: boolean) {
    const from = redo ? this.future : this.past;
    const to = redo ? this.past : this.future;
    const entry = from.at(-1);
    if (!entry) return;
    const revision = this.revision;
    const json = entry.readJson();
    const project = JSON.parse(json) as Project;
    const inverse = new HistoryEntry(current, entry.label);
    const next = moveHistory(from, to, inverse, this.byteLimit, 100);
    if (revision !== this.revision) throw Error('History changed while preparing this step.');
    this.revision++;
    this.past = redo ? next.destination : next.source;
    this.future = redo ? next.source : next.destination;
    if (inverse.bytes > this.byteLimit)
      this.notice = redo ? 'This step is too large to undo again.' : 'This step is too large to redo.';
    else if (this.past.length + this.future.length < from.length + to.length)
      this.notice = 'Older Undo or Redo history was trimmed.';
    return { project, json };
  }

  clear() {
    this.revision++;
    this.past = [];
    this.future = [];
    this.notice = '';
  }
}

/** Validate original source data before cloning or mutating document state. */
export function validateFrameScripts(scripts:unknown,duration:number):asserts scripts is FrameScript[]|undefined {
  if(scripts===undefined)return;
  assert(Array.isArray(scripts)&&scripts.length<=10000,'frame script table');
  let previous=-1,total=0;
  for(const entry of scripts){
    assert(entry&&typeof entry==='object'&&!Array.isArray(entry)&&Number.isSafeInteger(entry.frame)&&entry.frame>previous&&entry.frame<duration,'frame script position/order');
    assert(typeof entry.source==='string'&&entry.source.length<=256*1024,'frame script source');
    total+=new TextEncoder().encode(entry.source).byteLength;
    assert(total<=256*1024,'frame script source budget');
    previous=entry.frame;
  }
}

/** Shared stored-source limits across root and all symbol-local tables. No execution. */
export function validateProjectFrameScripts(project:Pick<Project,'duration'|'frameScripts'|'symbols'|'scenes'>):void {
  validateFrameScripts(project.frameScripts,project.duration);
  let count=project.frameScripts?.length??0;
  let bytes=(project.frameScripts??[]).reduce((sum,entry)=>sum+new TextEncoder().encode(entry.source).byteLength,0);
  for (const scene of project.scenes?.entries ?? []) {
    if (!scene.data) continue;
    const { frameScripts, duration } = scene.data;
    validateFrameScripts(frameScripts, duration);
    count += frameScripts?.length ?? 0;
    bytes += (frameScripts ?? []).reduce((sum,entry)=>sum+new TextEncoder().encode(entry.source).byteLength,0);
  }
  assert(project.symbols===undefined||Array.isArray(project.symbols),'symbol library');
  for(const definition of project.symbols??[]){
    assert(definition&&typeof definition==='object','symbol identity');
    assert(!('frameScripts' in definition),'symbol frame scripts belong to an existing timeline');
    const timeline=definition.timeline;
    if(timeline?.frameScripts!==undefined){
      assert(Number.isSafeInteger(timeline.duration)&&timeline.duration>=1&&timeline.duration<=10000,'symbol duration');
      validateFrameScripts(timeline.frameScripts,timeline.duration);
      count+=timeline.frameScripts.length;
      bytes+=timeline.frameScripts.reduce((sum,entry)=>sum+new TextEncoder().encode(entry.source).byteLength,0);
    }
  }
  assert(count<=10000,'frame script count budget');
  assert(bytes<=256*1024,'frame script source budget');
}

/** Atomic source-only update. Null removes a body; empty source remains an authored body. */
export function setFrameScript(project:Project,frame:number,source:string|null):void {
  assert(Number.isSafeInteger(frame)&&frame>=0&&frame<project.duration,'frame script position');
  validateProjectFrameScripts(project);
  const next=(project.frameScripts??[]).filter(entry=>entry.frame!==frame).map(entry=>({...entry}));
  if(source!==null)next.push({frame,source});
  next.sort((a,b)=>a.frame-b.frame);
  validateProjectFrameScripts({...project,frameScripts:next});
  if(next.length)project.frameScripts=next;else delete project.frameScripts;
}

function validateAudioClips(clips:unknown,duration:number,assets:Asset[]):asserts clips is AudioClip[]|undefined {
  if(clips===undefined)return;
  assert(Array.isArray(clips)&&clips.length<=10000,'audio clip count');
  const ids=new Set<string>(),audio=new Map(assets.filter(a=>a.audio).map(a=>[a.id,a.audio!]));
  for(const clip of clips){
    assert(clip&&typeof clip==='object'&&!Array.isArray(clip)&&typeof clip.id==='string'&&clip.id.length>0&&clip.id.length<=200&&!ids.has(clip.id),'audio clip identity');
    const asset=audio.get(clip.assetId);assert(asset,'audio clip asset reference');ids.add(clip.id);
    assert(Number.isSafeInteger(clip.startFrame)&&clip.startFrame>=0&&clip.startFrame<duration&&Number.isSafeInteger(clip.offsetSamples)&&clip.offsetSamples>=0&&clip.offsetSamples<=asset.frames,'audio clip timing');
    assert(typeof clip.gain==='number'&&Number.isFinite(clip.gain)&&Math.abs(clip.gain)<=16,'audio clip gain');
    for(const fade of [clip.fadeInSamples,clip.fadeOutSamples])assert(fade===undefined||(Number.isSafeInteger(fade)&&fade>=0&&fade<=asset.frames-clip.offsetSamples),'audio clip fade');
  }
}
/** Validates the original project and proposed references before the only write. */
export function setAudioClips(project:Project,clips:readonly AudioClip[]):void {
  validateProject(project);
  const next=validateProject({...project,audioClips:clips});
  if(next.audioClips!.length)project.audioClips=next.audioClips;else delete project.audioClips;
}
