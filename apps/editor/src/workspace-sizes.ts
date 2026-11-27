export type WorkspaceSizeKey = 'tools' | 'inspector' | 'timeline';
export type WorkspaceSizes = Record<WorkspaceSizeKey, number>;
export const DEFAULT_WORKSPACE_SIZES: WorkspaceSizes = { tools: 84, inspector: 262, timeline: 267 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
/** Clamp the displayed layout, retaining stored preferences for a larger window. */
export function workspaceSizing(
  saved: Partial<WorkspaceSizes> | undefined,
  width: number,
  height: number,
  sidebar = true,
) {
  const wanted = { ...DEFAULT_WORKSPACE_SIZES, ...saved };
  if (![width, height, ...Object.values(wanted)].every(Number.isFinite))
    throw Error('Invalid workspace dimensions.');
  const compact = width < 640;
  const stageMin = compact ? Math.floor(width * 0.45) : 320;
  const inspectorMin = compact ? Math.min(220, Math.floor(width / 3)) : 220;
  const toolsMax = Math.max(64, Math.min(240, width - (sidebar ? inspectorMin : 0) - stageMin));
  const tools = clamp(wanted.tools, 64, toolsMax);
  const inspectorMax = Math.max(inspectorMin, Math.min(640, width - tools - stageMin));
  const inspector = clamp(wanted.inspector, inspectorMin, inspectorMax);
  const timelineMax = Math.max(130, height - 240);
  const timeline = clamp(wanted.timeline, 130, timelineMax);
  return {
    tools,
    inspector,
    timeline,
    toolsMax: Math.max(64, Math.min(toolsMax, width - (sidebar ? inspector : 0) - stageMin)),
    inspectorMin,
    inspectorMax,
    timelineMax,
    timelineContent: timeline - 74,
    timelineRows: Math.max(1, Math.floor((timeline - 99) / 28)),
  };
}
