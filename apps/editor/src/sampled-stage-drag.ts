import type {Point,Project} from '../../../packages/document/src';
import type {SampledMotionOwner} from '../../../packages/animation/src/motion-owner';
import type {SampledGroupMotionOwner} from '../../../packages/animation/src/group-motion-owner';
import type {objectBounds} from '../../../packages/geometry/src';
import type {RotationView} from './sampled-rotation-handle';

// Keep the complete captured-drag contract outside the Svelte parser's script-token spread.
// Selection/pose parameters retain the component's exact inferred types; no runtime state moves.
export type SampledStageDrag<S extends Record<'pick'|'proposal'|'compoundNode'|'compound'|'tangent'|'groupCurve'|'rootCurve'|'rootWaypoint'|'waypoint'|'groupPivot'|'pivot'|'node'|'controls'|'pose',unknown>> = {
    pointer:number; pick:S['pick']; source:Project; signature:string;
    view:string; rect:DOMRect; x:number; y:number; scale:number;
    offsetX:number; offsetY:number;authoring:boolean;
    translation?:{owner:SampledMotionOwner & {groupId?:string;shapeIds?:string[]};frame:number;policy:number;inputRevision:number;inputAxes:{x:number;y:number};x:number;y:number;poseOffset?:Point};
    offsetDrafts?:{x:number|undefined;y:number|undefined};group?:SampledGroupMotionOwner;groupAuthoring?:boolean;groupPolicyRevision?:number;revision?:number;unitsX?:number;unitsY?:number;proposal?:S['proposal'];
    compoundNode?:{poseTarget?:Point;inputRevision:number;inputAxes:{x:number;y:number};authoring:boolean;releasePolicy:number;selection:S['compoundNode'];policy:number;start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;frame:number;observer:ResizeObserver};
    compound?:{poseTarget?:Point;inputRevision:number;inputAxes:{x:number;y:number};authoring:boolean;releasePolicy:number;selection:S['compound'];coupled:boolean;couplingRevision:number;policy:number;start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;frame:number;observer:ResizeObserver};
    tangent?:{poseTarget?:Point;inputRevision:number;inputAxes:{x:number;y:number};pairedAuthoring:boolean;pairedPolicy:number;coupled:boolean;couplingRevision:number;selection:S['tangent'];start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;policy:number;authoring:boolean;frame:number;observer:ResizeObserver};
    groupCurve?:{authoring:boolean;releasePolicy:number;selection:S['groupCurve'];part:'start'|'end';policy:number;inputRevision:number;start:Point;view:RotationView;before:S['controls'];controls:S['controls'];frame:number;observer:ResizeObserver};
    rootCurve?:{authoring:boolean;releasePolicy:number;selection:S['rootCurve'];part:'start'|'end';policy:number;inputRevision:number;start:Point;view:RotationView;before:S['controls'];controls:S['controls'];frame:number;observer:ResizeObserver};
    rootWaypoint?:{authoring:boolean;releasePolicy:number;selection:S['rootWaypoint'];policy:number;inputRevision:number;start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;frame:number;observer:ResizeObserver};
    waypoint?:{selection:S['waypoint'];authoring:boolean;releasePolicy:number;policy:number;inputRevision:number;start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;frame:number;observer:ResizeObserver};
    groupPivot?:{selection:S['groupPivot'];authoring:boolean;releasePolicy:number;policy:number;start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;frame:number;observer:ResizeObserver};
    pivot?:{selection:S['pivot'];authoring:boolean;releasePolicy:number;policy:number;start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;frame:number;observer:ResizeObserver};
    node?:{poseTarget?:Point;inputRevision:number;inputAxes:{x:number;y:number};selection:S['node'];start:Point;view:RotationView;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;policy:number;authoring:boolean;frame:number;observer:ResizeObserver};
    rotation?:{owner:SampledMotionOwner & {groupId?:string;shapeIds?:string[]};frame:number;policy:number;inputRevision:number;poseDegrees?:number;pivot:Point;view:RotationView;last:number;total:number;degrees:number;original:number|undefined};
    scaling?:{owner:SampledMotionOwner & {groupId?:string;shapeIds?:string[]};frame:number;policy:number;inputRevision:number;inputAxes:{x:number;y:number};poseFactors?:Point;handle:string;pivot:Point;box:ReturnType<typeof objectBounds>;view:RotationView;start:Point;factors:Point;originalX:number|undefined;originalY:number|undefined};
    skewing?:{owner:SampledMotionOwner & {groupId?:string;shapeIds?:string[]};frame:number;policy:number;inputRevision:number;inputAxes:{axis:number;angle:number};poseSkew?:{axis:'x'|'y';degrees:number};edge:string;axis:'x'|'y';angle:number;pivot:Point;box:ReturnType<typeof objectBounds>;view:RotationView;start:Point;originalAxis:'x'|'y';originalAngle:number|undefined};
    poseControls?:S['controls'];posePoint?:Point;
    pose?:S['pose'];
  };

// Exact numeric/gesture proposal metadata; all state remains in the component.
export type SampledStageProposal<S extends Record<'pick'|'waypoint'|'groupCurve'|'rootCurve'|'rootWaypoint'|'groupPivot'|'pivot'|'compoundNode'|'compound'|'controls'|'pose',unknown>> = {
    pick:S['pick']; stamp:string; x:number|undefined; y:number|undefined; angle:number|undefined; sx:number|undefined; sy:number|undefined; kind:'move'|'rotation'|'scale'|'skew'|'node'|'tangent'|'compound'|'compound-anchor'|'pivot'|'group-pivot'|'group-trajectory'|'root-trajectory'|'root-waypoint'|'group-waypoint';waypoint?:{selection:S['waypoint'];x:number|undefined;y:number|undefined;policy?:number};trajectory?:{selection:S['groupCurve'];controls:S['controls'];policy?:number;part?:'start'|'end'};rootTrajectory?:{selection:S['rootCurve'];controls:S['controls'];policy?:number;part?:'start'|'end'};rootWaypoint?:{selection:S['rootWaypoint'];x:number|undefined;y:number|undefined;policy?:number};groupPivot?:{selection:S['groupPivot'];x:number|undefined;y:number|undefined;policy?:number};pivot?:{selection:S['pivot'];x:number|undefined;y:number|undefined;policy?:number};anchor?:{selection:S['compoundNode'];x:number|undefined;y:number|undefined};compound?:{selection:S['compound'];x:number|undefined;y:number|undefined;coupled:boolean;revision:number};tangent?:{coupled:boolean;revision:number;index:number;count:number;part:'in'|'out';x:number|undefined;y:number|undefined};node?:{index:number;count:number;x:number|undefined;y:number|undefined};skewAxis:'x'|'y';skewAngle:number|undefined;
    pose:S['pose'];
  };

export type SampledNodeSelection<Pick> = {pick:Pick;index:number;count:number;point:Point};

export type SampledCompoundSelection<Pick> = {pick:Pick;contour:number;index:number;count:number;rings:number;part:'in'|'out';point:Point};

export type SampledCompoundAnchorSelection<Pick> = {pick:Pick;contour:number;index:number;count:number;rings:number;point:Point};

export type SampledPivotSelection<Pick> = {pick:Pick;point:Point};

export type SampledGroupWaypointRoute<Pick,Path> = {pick:Pick;owner:SampledGroupMotionOwner;origin:Point;path:Path&{waypoints:readonly Point[]}};

export type SampledRootWaypointRoute<Pick,Path> = {pick:Pick;owner:SampledMotionOwner;origin:Point;path:Path&{waypoints:readonly Point[]}};

export type SampledRootTrajectorySelection<Pick,Path> = {pick:Pick;owner:SampledMotionOwner;path:Path;start:Point;end:Point};

export type SampledGroupTrajectorySelection<Pick,Path> = {pick:Pick;owner:SampledGroupMotionOwner;path:Path;leaderId:string;start:Point;end:Point};

export type SampledGroupWaypointSelection<Route> = {route:Route;index:number;point:Point};

export type SampledRootWaypointSelection<Route> = {route:Route;index:number;point:Point};

export type SampledTangentSelection<Node> = {selection:Node;part:'in'|'out';point:Point};
