import type {SymbolStagePath} from './symbol-stage-ownership';
import type {PaintRegion} from '../../../packages/geometry/src/paint-region';
import type {TransformFrame,TransformHit} from './selection-transform';
import type {Point,Project,Vector} from '../../../packages/document/src';
import type {SampledMotionOwner} from '../../../packages/animation/src/motion-owner';
import type {SymbolEditContext} from '../../../packages/geometry/src/symbol-context';
import type {Bounds} from '../../../packages/geometry/src';
import type {SelectionMode} from '../../../packages/geometry/src/lasso';
import type {BitmapHandle} from '../../../packages/geometry/src/bitmap';
import type {PNGFileStream} from './png-file';
import type {ScriptTimelineConfig} from '../../../packages/scripting/src/timeline';

// Exact component state contracts only; no state or runtime behavior lives here.
export type EditorAudioPreviewConfig = {fps:number;duration:number;presentationProject?:Project;savedProject?:Project;loadSaved?:(path:string,signal:AbortSignal)=>Promise<Blob>;followFrame?:(frame:number)=>void;releaseFrame?:()=>void};

export type EditorPenSource = {
    project: string;
    layer: string;
    frame: number;
    revision: number;
    initial: Vector;
  };

export type EditorRecovery = {
    project: Project;
    folder: string | null;
    manifest: string | null;
  };

export type EditorHierarchyDrag = {
    token:string;source:Project;snapshot:Project;signature:string;at:number;layer:string;scope:string[];ids:string[];
  };

export type EditorScriptProgramSnapshot = {config:ScriptTimelineConfig;sources:{frame:number;source:string}[]};

export type EditorRememberedPreview = {promote?:(owner:SampledMotionOwner,offset?:{x:number;y:number})=>void;timeline:boolean;snapshot:Project;ids:string[];start:number;end:number;validate:()=>void};

export type EditorContextMenu<Action> = {
    x: number;
    y: number;
    items: Action[];
    project: string;
    revision: number;
  };

export type EditorTimelineDrag = {
  block?: boolean; copy?:boolean; originRow?:number;
    pointer: number;
    layers: string[];
    cross: boolean;
    target: string | null;
    projectId: string;
    layer: string;
    revision: number;
    start: number;
    end: number;
    origin: number;
    at: number;
  };

export type SymbolEditingSession = {
    workspace?: boolean;
    stageCamera?: {x:number;y:number;zoom:number};
    newDefinition?: boolean;
    sourceStamp?: string;
    newLibraryFolder?: string;
    timeline: boolean;
    context?: SymbolEditContext;
    stagePath?: SymbolStagePath;
    id: string;
    projectId: string;
    revision: number;
    definition: NonNullable<Project['symbols']>[number];
    parent?: SymbolEditingSession;
    location?: { layerId: string; frame: number };
  };

export type EditorGesture = {
      before: Project;
      start: Point;
      last: Point;
      kind:
        | 'draw'
        | 'move'
        | 'resize'
        | 'pan'
        | 'marquee'
        | 'node-marquee'
        | 'pen'
        | 'edge'
        | 'node'
        | 'multi-select'
        | 'multi-transform'
        | 'multi-frame'
        | 'region-move'
        | 'lasso'
        | 'erase'
        | 'brush-width'
        | 'bitmap'
        | 'gradient'
        | 'guide';
      transform?: { handle: string; bounds: Bounds; pivot: Point; originals: Vector[]; free?: {frame:TransformFrame;hit:TransformHit;key:string;region?:{selection:PaintRegion;frame:TransformFrame;pivot:Point}} };
      shiftSelection?: { id: string; position: Point; source: Project; signature: string };
      multiSelect?: { form: 'box' | 'lasso'; mode: SelectionMode };
      attachedFill?: import('../../../packages/geometry/src/attached-fill').AttachedFillEdit;
      strokeJunctions?: ReturnType<typeof import('./subselection').captureStrokeMoveJunctions>;
      edge?: {owner:string;outline:Vector;index:number;end:number;t:number};
      directReshape?: true;
      nodeBox?: { sets: Record<string, number[]>; mode: SelectionMode; context: string };
      nodeSets?: Record<string, number[]>;
      nodeRestore?: {sets:Record<string,number[]>;selected:string[];owner:string;pick:{index:number;part:'anchor'|'in'|'out'}|null};
      strokeFilter?: { distance: number; amount: number; optimize: boolean; contactMode?: 'normal' | 'behind' };
      pencilFilter?: {mode:'ink'|'smooth'|'straight';smoothing:number;optimize:boolean};
      penAnchorOffset?: Point;
      strokeAxis?: 'x' | 'y';
      bitmapPart?: BitmapHandle;
      brushWidthSample?: number;
      guideId?: string;
      shape?: Vector;
      basePan: Point;
    };

export type PNGSavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<PNGFileStream> }>;
