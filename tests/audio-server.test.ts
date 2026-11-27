import {afterEach,expect,it,vi} from 'vitest';
import {createServer,request,type Server} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {audioAssetHandler} from '../apps/editor/audio-server';
import {createDirectory,NodeDirectoryStore} from '../packages/document/src/node-store';
import {saveProject} from '../packages/document/src/storage';
import {newProject} from '../packages/document/src';
import {pcm16WavFixture} from './wav-fixture';
const roots:string[]=[],servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function setup(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'splash-audio-http-'));roots.push(root);await createDirectory(path.join(root,'Test.spl'));const store=new NodeDirectoryStore(path.join(root,'Test.spl'));await saveProject(store,newProject(),null);
 const server=createServer(audioAssetHandler(root));servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('missing port');
 const headers={'Host':'127.0.0.1:1420','Origin':'http://127.0.0.1:1420','Content-Type':'application/octet-stream','X-Splash-Project':'Test.spl','X-Splash-Path':'assets/audio/test.wav'};
 const send=(body:Uint8Array,overrides:Record<string,string>={})=>new Promise<{status:number;body:string;bytes:Buffer}>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:address.port,path:'/api/audio-assets',method:'POST',headers:{...headers,'Content-Length':body.length,...overrides}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const bytes=Buffer.concat(chunks);resolve({status:res.statusCode!,body:bytes.toString(),bytes});});});req.on('error',reject);req.end(body);});
 return {root,store,send,headers,port:address.port};
}
const wav=()=>pcm16WavFixture([[0,1234,-32768]]);
it('transports exact binary bytes and never overwrites an existing asset',async()=>{
 const {store,send}=await setup();expect((await send(wav())).status).toBe(200);expect(await store.readAudio('assets/audio/test.wav')).toEqual(wav());
 expect((await send(new Uint8Array(50))).status).toBe(400);expect(await store.readAudio('assets/audio/test.wav')).toEqual(wav());
});
it('rejects origin, host, type, destination, size and unsaved-project requests',async()=>{
 const {store,send}=await setup();for(const headers of ([{'Origin':'https://untrusted.example'},{'Host':'localhost:1420'},{'Content-Type':'application/json'},{'X-Splash-Path':'assets/audio/../test.wav'},{'X-Splash-Project':'../Test.spl'},{'Content-Length':String(64*1024*1024+1)},{'X-Splash-Project':'Missing.spl'}] as Record<string,string>[]))expect((await send(wav(),headers)).status).toBe(400);
 expect(await store.exists('assets/audio/test.wav')).toBe(false);expect((await send(wav())).status).toBe(200);
});
it('rejects concurrent uploads and cleans a disconnected partial body before retry',async()=>{
 const {store,send,headers,port}=await setup();
 const pending=request({hostname:'127.0.0.1',port,method:'POST',headers:{...headers,'Content-Length':50}});pending.on('error',()=>{});pending.flushHeaders();pending.write(new Uint8Array(12));
 // A second request waits until the first has reached its body read.
 await new Promise(resolve=>setTimeout(resolve,30));expect((await send(wav())).body).toContain('in progress');pending.destroy();
 await new Promise(resolve=>setTimeout(resolve,30));expect(await store.exists('assets/audio/test.wav')).toBe(false);expect((await send(wav())).status).toBe(200);
});

it('sends browser adapter Blob snapshots through the real HTTP endpoint',async()=>{
 const {port,store}=await setup();
 vi.stubGlobal('window',{});
 vi.stubGlobal('fetch',(async(_input:RequestInfo|URL,init?:RequestInit)=>{
  const body=init!.body instanceof Blob?new Uint8Array(await init!.body.arrayBuffer()):new TextEncoder().encode(String(init!.body));
  return new Promise<Response>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,method:'POST',headers:{...Object.fromEntries(new Headers(init?.headers).entries()),Host:'127.0.0.1:1420',Origin:'http://127.0.0.1:1420','Content-Length':body.length}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:{'Content-Type':String(res.headers['content-type']),'Content-Length':String(res.headers['content-length'])}}))); });req.on('error',reject);req.end(body);});
 }) as typeof fetch);
 try{
  const {audioDirectory}=await import('../apps/editor/src/storage');const directory=audioDirectory('Test.spl'),bytes=wav(),expected=bytes.slice();
  const pending=directory.writeNewAudio('assets/audio/client.wav',bytes);bytes.fill(0);await pending;
  expect(await store.readAudio('assets/audio/client.wav')).toEqual(expected);expect(await directory.readAudio('assets/audio/client.wav')).toEqual(expected);
  await expect(directory.writeNewAudio('assets/audio/client.wav',wav())).rejects.toThrow();
  const controller=new AbortController();controller.abort();await expect(directory.writeNewAudio('assets/audio/cancel.wav',wav(),controller.signal)).rejects.toThrow();expect(await store.exists('assets/audio/cancel.wav')).toBe(false);
 }finally{vi.unstubAllGlobals();}
});

it('reads exact saved bytes with bounded destinations and rejects missing or nonempty reads',async()=>{
 const {store,send}=await setup();await store.writeNewAudio('assets/audio/test.wav',wav());
 const result=await send(new Uint8Array(),{'X-Splash-Operation':'read'});expect(result.status).toBe(200);expect(new Uint8Array(result.bytes)).toEqual(wav());
 expect((await send(wav(),{'X-Splash-Operation':'read'})).status).toBe(400);
 expect((await send(new Uint8Array(),{'X-Splash-Operation':'read','X-Splash-Path':'assets/audio/missing.wav'})).status).toBe(400);
 expect((await send(new Uint8Array(),{'X-Splash-Operation':'erase'})).status).toBe(400);
 expect((await send(new Uint8Array(),{'X-Splash-Operation':'read'})).status).toBe(200);
});
it('rejects malformed or mismatched read envelopes and cancels response streams',async()=>{
 vi.stubGlobal('window',{});
 try{
  const {audioDirectory}=await import('../apps/editor/src/storage');const store=audioDirectory('Test.spl');
  for(const [length,count] of ([['67108865',12],['12',13],['13',12],['bad',12]] as [string,number][])){
   let cancelled=false;
   const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(count));if(length==='13')c.close();},cancel(){cancelled=true;}});
   vi.stubGlobal('fetch',async()=>new Response(body,{headers:{'Content-Type':'audio/wav','Content-Length':length}}));
   await expect(store.readAudio('assets/audio/test.wav')).rejects.toThrow();if(length!=='13')expect(cancelled).toBe(true);
  }
 }finally{vi.unstubAllGlobals();}
});
