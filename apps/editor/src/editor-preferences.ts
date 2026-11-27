export type TouchMode = 'pan' | 'tool' | 'ignore';
export const EDITOR_PREFERENCES_CONTEXT = Symbol('editor preferences');
export const EDITOR_PREFERENCES_KEY = 'splash-editor-preferences-v1';
export const CANVAS_ZOOM_FLOOR = 0.001;
export const CANVAS_ZOOM_CEILING = 100;
export const editorPreferenceDefaults = {
  pinchZoom: true,
  singleTouch: 'pan' as TouchMode,
  wheelZoom: true,
  minCanvasZoom: 0.05,
  maxCanvasZoom: 20,
  rulersVisible: true,
  guidesVisible: true,
  snapObjects: false,
  snapGrid: false,
  snapGuides: true,
  pressureSize: true,
  pressureOpacity: 'off' as 'off' | 'initial' | 'continuous',
  contactOpacityMinimum: 10,
  contactOpacityResponse: 1,
  minimumSize: 0.1,
  brushResponse: 1,
  tiltNib: false,
  twistNib: false,
  brushScreenSize: false,
  brushSize: 24,
  stabilization: 0,
  brushSmoothing: 50,
  brushOptimize: true,
  pencilSmoothing: 50,
  pencilOptimize: true,
  // New paint in Merge Drawing removes the parts of earlier lines it covers.
  removeCoveredStrokes: true,
  // Saved preferences without this marker were written while the default was off for a while;
  // they drop that value once.
  paintCoversLines: true as const,
};
export type EditorPreferences = typeof editorPreferenceDefaults;

export function normalizeEditorPreferences(value: unknown): EditorPreferences {
  const data = value && typeof value === 'object' ? value as Partial<EditorPreferences> : {};
  const defaults = editorPreferenceDefaults;
  const enabled = (key: keyof EditorPreferences) =>
    typeof data[key] === 'boolean' ? data[key] as boolean : defaults[key] as boolean;
  const number = (key: keyof EditorPreferences, min: number, max: number) => {
    const current = data[key];
    return typeof current === 'number' && Number.isFinite(current) && current >= min && current <= max
      ? current : defaults[key] as number;
  };
  const minCanvasZoom = number('minCanvasZoom', CANVAS_ZOOM_FLOOR, CANVAS_ZOOM_CEILING);
  const maxCanvasZoom = number('maxCanvasZoom', CANVAS_ZOOM_FLOOR, CANVAS_ZOOM_CEILING);
  const validZoomRange = minCanvasZoom <= maxCanvasZoom;
  return {
    pinchZoom: enabled('pinchZoom'),
    singleTouch: data.singleTouch === 'tool' || data.singleTouch === 'ignore' ? data.singleTouch : 'pan',
    wheelZoom: enabled('wheelZoom'), rulersVisible: enabled('rulersVisible'), guidesVisible: enabled('guidesVisible'),
    minCanvasZoom: validZoomRange ? minCanvasZoom : defaults.minCanvasZoom,
    maxCanvasZoom: validZoomRange ? maxCanvasZoom : defaults.maxCanvasZoom,
    snapObjects: enabled('snapObjects'), snapGrid: enabled('snapGrid'), snapGuides: enabled('snapGuides'),
    pressureSize: enabled('pressureSize'),
    pressureOpacity: data.pressureOpacity === 'initial' || data.pressureOpacity === 'continuous' ? data.pressureOpacity : 'off',
    contactOpacityMinimum: number('contactOpacityMinimum', 0, 100),
    contactOpacityResponse: number('contactOpacityResponse', 0.25, 4),
    minimumSize: number('minimumSize', 0.05, 0.5),
    brushResponse: number('brushResponse', 0.25, 4), tiltNib: enabled('tiltNib'), twistNib: enabled('twistNib'),
    brushScreenSize: enabled('brushScreenSize'), brushSize: number('brushSize', 1, 200),
    stabilization: number('stabilization', 0, 100), brushSmoothing: number('brushSmoothing', 0, 200),
    brushOptimize: enabled('brushOptimize'), pencilSmoothing: number('pencilSmoothing', 0, 200),
    pencilOptimize: enabled('pencilOptimize'), removeCoveredStrokes: enabled('removeCoveredStrokes'),
    paintCoversLines: true,
  };
}

export function loadEditorPreferences(): EditorPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(EDITOR_PREFERENCES_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && saved.paintCoversLines !== true) delete saved.removeCoveredStrokes;
    return normalizeEditorPreferences(saved);
  }
  catch { return { ...editorPreferenceDefaults }; }
}
