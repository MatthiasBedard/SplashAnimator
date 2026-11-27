import {expect,it,vi} from 'vitest';
import {createAudioPlayback,startTimelineAudioLoop} from '../packages/audio/src/playback';
const config={startFrame:0,endFrame:24,fps:24,sampleRate:8000};
function fixture(){
 const nodes:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;connect:ReturnType<typeof vi.fn>;onended:(()=>void)|null;buffer:unknown}[]=[];
 const copyToChannel=vi.fn(),context={sampleRate:8000,state:'running',currentTime:0,destination:{},resume:vi.fn(async()=>{}),close:vi.fn(),createBuffer:vi.fn(()=>({copyToChannel})),createBufferSource:vi.fn(()=>{const n={start:vi.fn(),stop:vi.fn(),disconnect:vi.fn(),connect:vi.fn(),onended:null as (()=>void)|null,buffer:null as unknown};nodes.push(n);return n;})};
 const playback=createAudioPlayback(context as unknown as AudioContext,[new Float32Array(8000)],config);return {context,nodes,playback,copyToChannel};
}
it('creates silently, schedules offsets, pauses and seeks without implicit playback',async()=>{
 const {context,nodes,playback}=fixture();expect(nodes).toHaveLength(0);await playback.play();expect(nodes[0].start).toHaveBeenCalledWith(0,0);context.currentTime=0.25;expect(playback.pause()).toMatchObject({frame:6,playing:false});expect(nodes[0].stop).toHaveBeenCalledOnce();context.currentTime=1;await playback.play();expect(nodes[1].start).toHaveBeenCalledWith(1,0.25);expect(playback.seek(12)).toMatchObject({frame:12,playing:false});expect(nodes[1].disconnect).toHaveBeenCalledOnce();await playback.play();expect(nodes[2].start).toHaveBeenCalledWith(1,0.5);playback.dispose();playback.dispose();expect(context.close).not.toHaveBeenCalled();expect(nodes[2].stop).toHaveBeenCalledOnce();expect(()=>playback.position()).toThrow();
});
it('invalid seeks preserve an active source and duplicate play does not restart',async()=>{
 const {nodes,playback}=fixture();await playback.play();await playback.play();expect(nodes).toHaveLength(1);expect(()=>playback.seek(24)).toThrow();expect(nodes[0].stop).not.toHaveBeenCalled();expect(playback.position().playing).toBe(true);
});
it('pending resume cannot revive paused, sought or disposed playback',async()=>{
 for(const mode of ['pause','seek','dispose']){const {context,nodes,playback}=fixture();let release!:()=>void;context.resume.mockImplementation(()=>new Promise<void>(r=>release=r));const pending=playback.play();if(mode==='pause')playback.pause();if(mode==='seek')playback.seek(4);if(mode==='dispose')playback.dispose();release();expect(await pending).toBeNull();expect(nodes).toHaveLength(0);}
});
it('source start failures clean up and a retry can succeed',async()=>{
 const {context,nodes,playback}=fixture(),create=context.createBufferSource.getMockImplementation()!;context.createBufferSource.mockImplementationOnce(()=>{const n=create();n.start.mockImplementation(()=>{throw Error('start failed');});return n;});await expect(playback.play()).rejects.toThrow('start failed');expect(nodes[0].disconnect).toHaveBeenCalledOnce();expect(playback.position().playing).toBe(false);await playback.play();expect(playback.position().playing).toBe(true);
});
it('rejects invalid original PCM before creating platform buffers',()=>{
 const {context}=fixture();context.createBuffer.mockClear();const samples=new Float32Array(8000);samples[7999]=NaN;expect(()=>createAudioPlayback(context as unknown as AudioContext,[samples],config)).toThrow();expect(context.createBuffer).not.toHaveBeenCalled();expect(Number.isNaN(samples[7999])).toBe(true);
});

it('uses the original rounded sample for playback start and wraps the visual frame with the audio buffer',()=>{
 const {context,nodes}=fixture();
 const loop=startTimelineAudioLoop(context as unknown as AudioContext,[new Float32Array(1335)],29.97,5,2);
 expect(nodes[0]).toMatchObject({loop:true});
 expect(nodes[0].start).toHaveBeenCalledWith(0,534/8000);
 expect(loop.position()).toEqual({frame:2,absoluteFrame:2});
 context.currentTime=(1335-534-0.25)/8000;
 expect(loop.position()).toEqual({frame:4,absoluteFrame:4});
 context.currentTime=(1335-534+0.25)/8000;
 expect(loop.position()).toEqual({frame:0,absoluteFrame:5});
 context.currentTime=(1335-534+267.25)/8000;
 expect(loop.position()).toEqual({frame:1,absoluteFrame:6});
 loop.stop();loop.stop();
 expect(nodes[0].stop).toHaveBeenCalledOnce();
 expect(nodes[0].disconnect).toHaveBeenCalledOnce();
 expect(()=>loop.position()).toThrow();
});
