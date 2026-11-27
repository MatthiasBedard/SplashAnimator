import type { DirectoryStore, AudioAssetStore, CommitReceipt } from '../../../packages/document/src/storage';
export const desktop = '__TAURI_INTERNALS__' in window;
export async function request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (desktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>('project_operation', { request: { op, ...args } });
  }
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...args }),
  });
  const data = (await response.json()) as { result: T; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}
export function directory(project: string): DirectoryStore {
  return {
    read: (path) => request('read', { project, path }),
    exists: (path) => request('exists', { project, path }),
    writeNew: (path, content) => request('write', { project, path, content }),
    async commit(path, content, expected) {
      const args = { project, path, content, expected };
      if (desktop) return request<CommitReceipt>('commit', args);
      await request('commit', args);
    },
  };
}

const maxAudioBytes = 64 * 1024 * 1024;

function nativeAudioDirectory(project: string): AudioAssetStore {
  return {
    async readAudio(path, signal) {
      signal?.throwIfAborted();
      const { invoke } = await import('@tauri-apps/api/core');
      signal?.throwIfAborted();
      const data = await invoke<ArrayBuffer>('project_audio_read', { owner: { project, path } });
      signal?.throwIfAborted();
      if (!(data instanceof ArrayBuffer) || data.byteLength < 12 || data.byteLength > maxAudioBytes)
        throw Error('Audio asset response is missing or exceeds byte limits.');
      return new Uint8Array(data);
    },
    async writeNewAudio(path, bytes, signal) {
      signal?.throwIfAborted();
      if (bytes.byteLength < 12 || bytes.byteLength > maxAudioBytes)
        throw Error('Audio upload exceeds byte limits.');
      const owner = new TextEncoder().encode(JSON.stringify({ project, path }));
      const payload = new Uint8Array(4 + owner.byteLength + bytes.byteLength);
      new DataView(payload.buffer).setUint32(0, owner.byteLength, true);
      payload.set(owner, 4);
      payload.set(bytes, 4 + owner.byteLength);
      const { invoke } = await import('@tauri-apps/api/core');
      signal?.throwIfAborted();
      await invoke('project_audio_write', payload.buffer);
      signal?.throwIfAborted();
    },
  };
}

export function audioDirectory(project:string):AudioAssetStore{
 if(desktop)return nativeAudioDirectory(project);
 return {async readAudio(path,signal){
  signal?.throwIfAborted();
  const response=await fetch('/api/audio-assets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Splash-Project':project,'X-Splash-Path':path,'X-Splash-Operation':'read'},body:'',signal});
  const length=response.headers.get('Content-Length'),size=Number(length);
  if(!response.ok||response.headers.get('Content-Type')!=='audio/wav'||!length||!/^\d+$/.test(length)||!Number.isSafeInteger(size)||size<12||size>64*1024*1024){await response.body?.cancel();throw new Error('Audio asset response is missing or exceeds byte limits.');}
  if(!response.body)throw new Error('Audio asset response has no body.');
  const reader=response.body.getReader(),bytes=new Uint8Array(size);let offset=0;
  try{
   while(true){signal?.throwIfAborted();const {value,done}=await reader.read();signal?.throwIfAborted();if(done)break;if(offset+value.byteLength>size)throw new Error('Audio asset response length changed.');bytes.set(value,offset);offset+=value.byteLength;}
   if(offset!==size)throw new Error('Audio asset response length changed.');return bytes;
  }finally{try{await reader.cancel();}finally{reader.releaseLock();}}
 },async writeNewAudio(path,bytes,signal){
  signal?.throwIfAborted();
  if(bytes.byteLength<12||bytes.byteLength>64*1024*1024)throw new Error('Audio upload exceeds byte limits.');
  const payload=new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'});
  const response=await fetch('/api/audio-assets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Splash-Project':project,'X-Splash-Path':path},body:payload,signal});
  const result=await response.json() as {result?:boolean;error?:string};
  if(!response.ok||result.result!==true)throw new Error(result.error??'Audio upload failed.');
  signal?.throwIfAborted();
 }};
}
