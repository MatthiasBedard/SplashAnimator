import { readFrameLabels, validateFrameLabels, type FrameLabel } from '../../document/src/frame-labels';

/** Deterministic timeline capability for a future isolated script host.
 * Frames are zero-based. No wall clock, browser object or host IPC is exposed.
 */
export interface ScriptTimelineConfig {
  duration: number;
  fps: number;
  seed: number;
  frameLabels?: readonly FrameLabel[];
}
export interface ScriptTimelineCheckpoint extends ScriptTimelineConfig {
  version: 1;
  frame: number;
  playing: boolean;
  tick: number;
  randomState: number;
}
export interface ScriptTimelineAPI {
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly fps: number;
  readonly playing: boolean;
  play(): void;
  stop(): void;
  gotoAndPlay(frame: number | string): void;
  gotoAndStop(frame: number | string): void;
}
export interface ScriptRuntime {
  /** Reproducible value in [0, 1); never uses Math.random. */
  random(): number;
}
export interface ScriptTimelineHost {
  readonly api: ScriptTimelineAPI;
  readonly runtime: ScriptRuntime;
  /** One simulation tick; stopped timelines still receive host ticks. */
  advance(holdFrame?: boolean): void;
  /** Whether a seek command succeeded since construction/restore. Host-only dispatch metadata. */
  readonly sought: boolean;
  checkpoint(): ScriptTimelineCheckpoint;
  restore(checkpoint: unknown): void;
}

export function createScriptTimeline(config: ScriptTimelineConfig): ScriptTimelineHost {
  return createScriptTimelineRuntime(config, readFrameLabels, validateFrameLabels);
}

export function createScriptTimelineRuntime(
  config: ScriptTimelineConfig,
  readLabels: typeof readFrameLabels,
  validateLabels: typeof validateFrameLabels,
): ScriptTimelineHost {
  // Keep this factory self-contained for serialization into an isolated worker.
  const uint32 = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
  const natural = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const { duration, fps, seed } = config;
  if (!Number.isSafeInteger(duration) || duration < 1 ||
      !Number.isFinite(fps) || fps <= 0 || !uint32(seed))
    throw new Error('Invalid script timeline configuration.');
  function admittedLabels(source: object): FrameLabel[] | undefined {
    const value = readLabels(source);
    validateLabels(value, duration);
    return value?.length ? value : undefined;
  }
  const labels = admittedLabels(config)?.map(({ frame, name }) => ({ frame, name }));
  const byName = new Map(labels?.map(({ name, frame }) => [name, frame]));
  let frame = 0, playing = true, tick = 0, randomState = seed, sought = false;
  function seek(value: number | string, nextPlaying: boolean) {
    const target = typeof value === 'string' ? byName.get(value) : value;
    if (typeof value === 'string' && target === undefined) throw Error('Unknown script frame label.');
    if (!natural(target) || target >= duration)
      throw new Error('Script frame must be an integer within the timeline.');
    frame = target; playing = nextPlaying; sought = true;
  }
  const api: ScriptTimelineAPI = Object.freeze({
    get currentFrame() { return frame; },
    get totalFrames() { return duration; },
    get fps() { return fps; },
    get playing() { return playing; },
    play() { playing = true; },
    stop() { playing = false; },
    gotoAndPlay(value: number | string) { seek(value, true); },
    gotoAndStop(value: number | string) { seek(value, false); },
  });
  class ScriptRuntime {
    random() {
      // Mulberry32: state and bitwise operations are serialized explicitly.
      randomState = (randomState + 0x6d2b79f5) >>> 0;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
  }
  Object.freeze(ScriptRuntime.prototype);
  return Object.freeze({
    api,
    runtime: Object.freeze(new ScriptRuntime()),
    get sought() { return sought; },
    advance(holdFrame = false) {
      if (tick === Number.MAX_SAFE_INTEGER) throw new Error('Script tick exceeds numeric limits.');
      tick++;
      if (playing && !holdFrame) frame = frame === duration - 1 ? 0 : frame + 1;
    },
    checkpoint() {
      return {version: 1 as const, duration, fps, seed, frame, playing, tick, randomState,
        ...(labels ? { frameLabels: labels.map(label => ({ ...label })) } : {})};
    },
    restore(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid script timeline checkpoint.');
      const next = value as Record<string, unknown>;
      // Read all values before committing so failed restores never alter live state.
      const {version, duration: length, fps: rate, seed: initialSeed,
        frame: position, playing: running, tick: time, randomState: random} = next;
      const restoredLabels = admittedLabels(next);
      if (version !== 1 || length !== duration || rate !== fps || initialSeed !== seed ||
          !natural(position) || position >= duration || typeof running !== 'boolean' ||
          !natural(time) || !uint32(random) || restoredLabels?.length !== labels?.length ||
          restoredLabels?.some((label, index) => label.name !== labels![index].name || label.frame !== labels![index].frame))
        throw new Error('Invalid or incompatible script timeline checkpoint.');
      frame = position; playing = running; tick = time; randomState = random; sought = false;
    },
  });
}


export type ScriptValue = null | boolean | number | string | ScriptValue[] | {[key:string]:ScriptValue};
export type ScriptState = {[key:string]:ScriptValue};

/** Detached JSON state with explicit depth, node and serialized-size budgets. */
export function cloneScriptState(input: unknown): ScriptState {
  let nodes=0,remainingBytes=65536;
  const ancestors=new Set<object>();
  function charge(bytes:number){
    remainingBytes-=bytes;
    if(remainingBytes<0)throw new Error('Script state exceeds 64 KiB.');
  }
  function chargeString(value:string){
    // Count the UTF-8 bytes JSON will emit, including quotes and escapes.
    charge(value.length+2);
    for(let i=0;i<value.length;i++){
      const code=value.charCodeAt(i);
      if(code===34||code===92||code===8||code===9||code===10||code===12||code===13)charge(1);
      else if(code<32)charge(5);
      else if(code<128)continue;
      else if(code<2048)charge(1);
      else if(code>=0xd800&&code<=0xdfff){
        const next=value.charCodeAt(i+1);
        if(code<=0xdbff&&next>=0xdc00&&next<=0xdfff){charge(2);i++;}
        else charge(5);
      }else charge(2);
    }
  }
  function copy(value:unknown,depth:number):ScriptValue {
    if(++nodes>10000||depth>32)throw new Error('Script state exceeds structural limits.');
    if(value===null||typeof value==='boolean'){charge(value===false?5:4);return value;}
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw new Error('Script state numbers must be finite.');
      charge(String(value).length);
      return value===0?0:value; // JSON has one canonical zero.
    }
    if(typeof value==='string'){
      chargeString(value);
      return value;
    }
    if(typeof value!=='object'||ancestors.has(value))throw new Error('Script state must be acyclic JSON.');
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(!array&&prototype!==Object.prototype&&prototype!==null)throw new Error('Script state must contain plain objects.');
    const arrayLength=array?Object.getOwnPropertyDescriptor(value,'length')?.value as number:0;
    if(array&&(!Number.isSafeInteger(arrayLength)||arrayLength<0||arrayLength>10000-nodes))
      throw new Error('Script state exceeds structural limits.');
    charge(2);
    ancestors.add(value);
    const result:ScriptValue[]|ScriptState=array?[]:Object.create(null);
    const keys=Reflect.ownKeys(value);
    if(keys.length>10001)throw new Error('Script state exceeds structural limits.');
    let first=true;
    for(const key of keys){
      if(array&&key==='length')continue;
      if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))
        throw new Error('Unsupported script state key.');
      const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
      if(!descriptor.enumerable||!('value' in descriptor))throw new Error('Script state accessors are unsupported.');
      if(!first)charge(1);
      first=false;
      if(!array){chargeString(key);charge(1);}
      if(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)!==(result as ScriptValue[]).length))
        throw new Error('Script state arrays must be dense.');
      Object.defineProperty(result,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
    }
    if(array&&(result as ScriptValue[]).length!==arrayLength)throw new Error('Script state arrays must be dense.');
    ancestors.delete(value);
    return result;
  }
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Script state root must be an object.');
  return copy(input,0) as ScriptState;
}
