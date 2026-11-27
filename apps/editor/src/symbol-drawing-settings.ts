import { tools, type Tool } from '../../../packages/interaction/src';

export type SymbolCanvasTool =
  | 'select'
  | 'text'
  | 'hierarchy'
  | 'hierarchy-move'
  | 'hierarchy-rotate'
  | 'hierarchy-scale'
  | 'hierarchy-skew'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'pencil'
  | 'pen'
  | 'nodes'
  | 'brush'
  | 'ink'
  | 'eyedropper'
  | 'bucket'
  | 'bitmap'
  | 'gradient';

export type SymbolDrawingSettings = {
  canvasTool: SymbolCanvasTool;
  newFill: string;
  newStroke: string;
  newLineWidth: number;
  brushWidth: number;
  brushSimplify: number;
  brushLockToCanvas: boolean;
  brushOptimize: boolean;
  brushObjects: boolean;
  contactOpacityEnabled: boolean;
  strokeOpacityEnabled: boolean;
  contactOpacityMinimum: number;
  contactOpacityResponse: number;
  removeCoveredStrokes: boolean;
  pencilMode: 'raw' | 'smooth' | 'straight';
  pencilSimplify: number;
  pencilOptimize: boolean;
  pencilObjects: boolean;
};
const workspaceTools: Partial<Record<Tool, SymbolCanvasTool>> = {
  select: 'select',
  subselect: 'nodes',
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  text: 'text',
  path: 'pencil',
  brush: 'brush',
  pen: 'pen',
  bucket: 'bucket',
  ink: 'ink',
  eyedropper: 'eyedropper',
  gradient: 'gradient',
};

export const symbolWorkspaceTools = tools.flatMap((tool) => {
  const mode = workspaceTools[tool.id];
  return mode ? [{ ...tool, mode }] : [];
});
