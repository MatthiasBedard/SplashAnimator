import {afterEach,expect,it,vi} from 'vitest';
import {openVp8Encoder} from '../packages/export-video/src/vp8';
const settings={width:2,height:2,frameCount:2,rate:30000,scale:1001,bitrate:100000};
class Frame{
 static closed=0;bytes:Uint8Array;constructor(bytes:Uint8Array,public init:VideoFrameBufferInit){this.bytes=bytes.slice();}close(){Frame.closed++;}
}
class Encoder{
 static instances:Encoder[]=[];static stall=false;static omit=false;static packetBytes=1;static forceDelta=false;
 state='unconfigured';pending:Frame[]=[];seen:Frame[]=[];requests:boolean[]=[];
 constructor(public init:VideoEncoderInit){Encoder.instances.push(this);}
 configure(){this.state='configured';}encode(frame:Frame,options:VideoEncoderEncodeOptions){this.pending.push(frame);this.seen.push(frame);this.requests.push(Boolean(options.keyFrame));}
 async flush(){if(Encoder.stall)return new Promise<void>(()=>{});await Promise.resolve();for(const frame of this.pending.splice(0))if(!Encoder.omit)this.init.output({timestamp:frame.init.timestamp,type:!Encoder.forceDelta&&this.requests[this.seen.indexOf(frame)]?'key':'delta',byteLength:Encoder.packetBytes,copyTo:(b:Uint8Array)=>b.fill(42)} as unknown as EncodedVideoChunk,{});}
 close(){this.state='closed';}
}
function setup(){Frame.closed=0;Encoder.instances=[];Encoder.stall=false;Encoder.omit=false;Encoder.packetBytes=1;Encoder.forceDelta=false;vi.stubGlobal('VideoFrame',Frame);vi.stubGlobal('VideoEncoder',Encoder);}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('snapshots frames and settings, uses absolute rational timing and closes on receipt',async()=>{
 setup();const options={...settings},host=openVp8Encoder(options),rgba=new Uint8Array(16).fill(255);options.rate=1;const job=host.append(rgba);rgba.fill(0);await job;await host.append(new Uint8Array(16).fill(255));const out=host.finish();expect(out.frameCount).toBe(2);expect(out.bytes.length).toBe(58);expect(Encoder.instances[0].seen.map(f=>[f.init.timestamp,f.init.duration])).toEqual([[0,33367],[33367,33366]]);expect(Encoder.instances[0].seen[0].bytes[0]).toBe(255);expect(Frame.closed).toBe(2);expect(Encoder.instances[0].state).toBe('closed');expect(()=>host.finish()).toThrow(/closed/);
});
it('cancels stalled work, rejects concurrent frames and closes at deadline',async()=>{
 setup();Encoder.stall=true;const abort=new AbortController(),host=openVp8Encoder(settings,{signal:abort.signal});const pending=host.append(new Uint8Array(16).fill(255));await expect(host.append(new Uint8Array(16).fill(255))).rejects.toThrow(/pending/);abort.abort(Error('cancel test'));await expect(pending).rejects.toThrow('cancel test');expect(()=>host.finish()).toThrow('cancel test');expect(Encoder.instances[0].state).toBe('closed');
 vi.useFakeTimers();const timed=openVp8Encoder(settings,{timeoutMs:5}),job=timed.append(new Uint8Array(16).fill(255));const rejected=expect(job).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(5);await rejected;expect(Encoder.instances[1].state).toBe('closed');
});
it('rejects invalid admission, alpha, missing output and exhausted output budget',async()=>{
 setup();expect(()=>openVp8Encoder({...settings,width:100000})).toThrow();expect(Encoder.instances).toHaveLength(0);
 const host=openVp8Encoder(settings);await expect(host.append(new Uint8Array(16))).rejects.toThrow(/opaque/);expect(()=>host.finish()).toThrow(/incomplete/);Encoder.omit=true;await expect(host.append(new Uint8Array(16).fill(255))).rejects.toThrow(/omitted/);expect(Encoder.instances[0].state).toBe('closed');
 Encoder.omit=false;const capped=openVp8Encoder(settings,{maxBytes:58});Encoder.packetBytes=10;await expect(capped.append(new Uint8Array(16).fill(255))).rejects.toThrow(/budget/);expect(()=>capped.finish()).toThrow(/budget/);expect(Encoder.instances[1].state).toBe('closed');
 const disposed=openVp8Encoder(settings);disposed.dispose();disposed.dispose();await expect(disposed.append(new Uint8Array(16).fill(255))).rejects.toThrow(/disposed/);
});

it('requests captured periodic keyframes and admits ordered delta packets',async()=>{
 setup();const config={...settings,frameCount:7,keyFrameInterval:3};const host=openVp8Encoder(config);config.keyFrameInterval=1;for(let i=0;i<7;i++)await host.append(new Uint8Array(16).fill(255));const out=host.finish();expect(Encoder.instances[0].requests).toEqual([true,false,false,true,false,false,true]);expect([out.keyFrames,out.deltaFrames]).toEqual([3,4]);expect(out.frameCount).toBe(7);
});
it('rejects invalid intervals and delta output at a required keyframe',async()=>{
 setup();for(const keyFrameInterval of [0,301,1.5,NaN,null])expect(()=>openVp8Encoder({...settings,keyFrameInterval} as typeof settings)).toThrow();expect(Encoder.instances).toHaveLength(0);const host=openVp8Encoder({...settings,keyFrameInterval:3});Encoder.forceDelta=true;await expect(host.append(new Uint8Array(16).fill(255))).rejects.toThrow(/frame type/);expect(()=>host.finish()).toThrow(/frame type/);expect(Encoder.instances[0].state).toBe('closed');
});
it('captures WebM selection, preserves IVF default and rejects unknown containers before allocation',async()=>{
 setup();for(const container of ['mp4',null,0])expect(()=>openVp8Encoder({...settings,container} as unknown as Parameters<typeof openVp8Encoder>[0])).toThrow();expect(Encoder.instances).toHaveLength(0);
 const config={...settings,container:'webm' as 'webm'|'ivf',keyFrameInterval:2},host=openVp8Encoder(config);config.container='ivf';for(let i=0;i<2;i++)await host.append(new Uint8Array(16).fill(255));const out=host.finish();expect(out.container).toBe('webm');expect(Array.from(out.bytes.slice(0,4))).toEqual([26,69,223,163]);expect([out.keyFrames,out.deltaFrames]).toEqual([1,1]);expect(Encoder.instances[0].state).toBe('closed');
});
it('cleans WebM retained output on cancellation and rejects packets before copying over budget',async()=>{
 setup();const config={...settings,container:'webm' as const};const abort=new AbortController(),host=openVp8Encoder(config,{signal:abort.signal});await host.append(new Uint8Array(16).fill(255));Encoder.stall=true;const job=host.append(new Uint8Array(16).fill(255));abort.abort(Error('webm cancel'));await expect(job).rejects.toThrow('webm cancel');expect(()=>host.finish()).toThrow('webm cancel');expect(Encoder.instances[0].state).toBe('closed');
 Encoder.stall=false;Encoder.packetBytes=3;const capped=openVp8Encoder(config,{maxBytes:1538});await expect(capped.append(new Uint8Array(16).fill(255))).rejects.toThrow(/budget/);expect(()=>capped.finish()).toThrow(/budget/);expect(Encoder.instances[1].state).toBe('closed');
});
