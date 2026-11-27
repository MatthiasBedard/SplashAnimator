export interface ScriptStageInfo {
  readonly width: number;
  readonly height: number;
  readonly layerCount: number;
}

export function captureScriptStage(stage?: ScriptStageInfo): ScriptStageInfo | undefined {
  if (stage === undefined) return undefined;
  const { width, height, layerCount } = stage;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0 ||
      !Number.isSafeInteger(layerCount) || layerCount < 0 || layerCount > 1000)
    throw Error('Invalid script stage dimensions or layer count.');
  return { width, height, layerCount };
}
