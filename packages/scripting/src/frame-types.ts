/** Shared trusted declarations; source checking and editor intelligence use the same API. */
export const frameTypes = `interface SplashTimeline {
  readonly currentFrame: number; readonly totalFrames: number;
  readonly fps: number; readonly playing: boolean;
  play(): void; stop(): void; gotoAndPlay(frame: number | string): void;
  gotoAndStop(frame: number | string): void;
}
interface ScriptRuntime {
  /** Return a reproducible number from 0 inclusive to 1 exclusive. */
  random(): number;
}
declare const runtime: ScriptRuntime;
type SplashValue = null | boolean | number | string | SplashValue[] | { [key: string]: SplashValue };
interface SplashState { [key: string]: SplashValue }
type SplashInputValue = null | boolean | number | string | ReadonlyArray<SplashInputValue> | { readonly [key: string]: SplashInputValue };
type SplashTextInput = {
  readonly binding: string;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly selectionDirection: "forward" | "backward" | "none";
};
interface SplashInput {
  readonly [key: string]: SplashInputValue | undefined;
  readonly textInput?: SplashTextInput;
}
interface SplashDynamicText {
  set(binding: string, content: string): void;
  setForInstance(instanceName: string, binding: string, content: string): void;
}
interface SplashPlacement { readonly id: string; readonly name: string; readonly layerId: string; readonly symbolId: string; readonly visible: boolean; readonly parentId?: string }
interface SplashPlacementTransform { readonly x: number; readonly y: number; readonly rotation: number }
type SplashPlacementBasis = readonly [a: number, b: number, c: number, d: number];
type SplashLibraryItem = { readonly link: string; readonly id: string; readonly name: string } & (
  { readonly kind: "symbol"; readonly width: number; readonly height: number; readonly defaultPlayback: "loop" | "movie"; readonly canSpawn: boolean; readonly timed?: true } |
  { readonly kind: "bitmap"; readonly width: number; readonly height: number; readonly canSpawn: boolean } |
  { readonly kind: "audio"; readonly format: "pcm16-wav"; readonly sampleRate: number; readonly channels: 1 | 2; readonly frames: number }
);
interface SplashLibrary {
  /** Read metadata for an authored library link. Missing links return undefined. */
  get(link: string): SplashLibraryItem | undefined;
  /** Place an eligible linked symbol with its authored playback default under a script-owned preview name. */
  spawnGraphic(link: string, name: string, position: SplashPlacementTransform): void;
  /** Place a linked bitmap with captured image data at its natural size. */
  spawnBitmap(link: string, name: string, position: SplashPlacementTransform): void;
}
interface SplashStage {
  readonly library: SplashLibrary;
  /** Available only when sound is enabled for the explicit preview. */
  readonly sound?: {
    /** Replace the current voice with a linked WAV, starting at a zero-based sample. */
    play(link: string, offsetSamples?: number, gain?: number): void;
    stop(): void;
    /** Freeze the current logical sample position until resumed. */
    pause(): void;
    resume(): void;
    /** Seek to a zero-based sample or the endpoint, preserving the paused state. */
    seekSamples(offsetSamples: number): void;
    /** Logical sample position on the preview tick clock. */
    positionSamples(): number | undefined;
  };
  /** Place a captured static library graphic in the preview under a script-owned name. */
  spawnGraphic(name: string, symbolId: string, position: SplashPlacementTransform): void;
  /** Read a graphic previously spawned by the preview. */
  getSpawned(name: string): (SplashPlacementTransform & { readonly name: string } & (
    { readonly symbolId: string; readonly kind?: never; readonly assetId?: never } |
    { readonly kind: "bitmap"; readonly assetId: string; readonly symbolId?: never }
  )) | undefined;
  /** Remove a script-owned graphic by its preview name. */
  removeSpawned(name: string): void;
  /** Read the current preview position and rotation of an owned named root graphic. */
  getTransform(name: string, layerId?: string): SplashPlacementTransform | undefined;
  /** Change absolute position and rotation in degrees for this authored exposure in the preview. */
  setTransform(name: string, transform: SplashPlacementTransform, layerId?: string): void;
  /** Read the local linear basis before placement rotation. Identity is [1, 0, 0, 1]. */
  getBasis(name: string, layerId?: string): SplashPlacementBasis | undefined;
  /** Set local scale, shear or reflection. Maps (x, y) to (a*x+c*y, b*x+d*y) before rotation. */
  setBasis(name: string, basis: SplashPlacementBasis, layerId?: string): void;
  /** Change preview visibility of a named graphic or eligible direct button exposure without changing its playback. */
  setVisible(name: string, visible: boolean, layerId?: string): void;
  /** Find an authored symbol on the current frame of this timeline. Missing names return undefined. Supply a layer ID to disambiguate names across layers. */
  getInstance(name: string, layerId?: string): SplashPlacement | undefined;
  /** Find an exposed named graphic or button child inside an eligible graphic parent. */
  getChildInstance(parentName: string, name: string, layerId?: string): SplashPlacement | undefined;
  setChildVisible(parentName: string, name: string, visible: boolean, layerId?: string): void;
  readonly width: number; readonly height: number; readonly layerCount: number }
declare const stage: SplashStage | undefined;
declare const splashText: SplashDynamicText;
`;
