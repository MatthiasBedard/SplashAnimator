import type {IncomingMessage,ServerResponse} from 'node:http';
import path from 'node:path';
import {NodeDirectoryStore} from '../../packages/document/src/node-store';
/** Development-only binary endpoint. Serial admission bounds resident request bodies. */
export function audioAssetHandler(root:string){
 let busy=false;
 return async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Connection','close');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const controller=new AbortController();let admitted=false;
  const abort=()=>controller.abort(new Error('Audio upload disconnected.'));
  const timer=setTimeout(()=>{controller.abort(new Error('Audio upload timed out.'));if(res.headersSent){res.destroy();}else if(!res.writableEnded){res.statusCode=408;res.end(JSON.stringify({error:'Audio upload timed out.'}));}req.destroy();},10000);
  req.on('aborted',abort);res.on('close',abort);
  try{
   if(req.method!=='POST'||req.headers.host!=='127.0.0.1:1420'||req.headers.origin!=='http://127.0.0.1:1420'||req.headers['content-type']!=='application/octet-stream')throw new Error('Rejected non-loopback or cross-origin audio upload.');
   const project=req.headers['x-splash-project'],relative=req.headers['x-splash-path'];
   if(typeof project!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,80}\.spl$/.test(project)||typeof relative!=='string'||!/^assets\/audio\/[a-zA-Z0-9_-]{1,200}\.wav$/.test(relative))throw new Error('Invalid audio destination.');
   const operation=req.headers['x-splash-operation']??'write';
   if(operation!=='read'&&operation!=='write')throw new Error('Invalid audio operation.');
   const length=req.headers['content-length'];
   if(typeof length!=='string'||!/^\d+$/.test(length))throw new Error('Audio upload requires a declared length.');
   const size=Number(length);if(!Number.isSafeInteger(size)||(operation==='read'?size!==0:size<12||size>64*1024*1024))throw new Error('Audio upload exceeds byte limits.');
   if(busy)throw new Error('Another audio upload is in progress.');busy=true;admitted=true;
   const store=new NodeDirectoryStore(path.join(root,project));
   if(!await store.exists('project.json'))throw new Error('Save the project before importing audio.');
   controller.signal.throwIfAborted();
   const bytes=new Uint8Array(size);let offset=0;
   for await(const chunk of req){controller.signal.throwIfAborted();const data=chunk as Buffer;if(offset+data.length>size)throw new Error('Audio upload length changed.');bytes.set(data,offset);offset+=data.length;}
   if(offset!==size)throw new Error('Audio upload length changed.');controller.signal.throwIfAborted();
   if(operation==='read'){
    const output=await store.readAudio(relative,controller.signal);controller.signal.throwIfAborted();
    res.setHeader('Content-Type','audio/wav');res.setHeader('Content-Length',output.byteLength);
    await new Promise<void>((resolve,reject)=>{
     const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Audio response disconnected.'));};
     const cleanup=()=>{res.removeListener('finish',done);res.removeListener('close',failed);res.removeListener('error',failed);};
     res.once('finish',done);res.once('close',failed);res.once('error',failed);res.end(output);
    });return;
   }
   await store.writeNewAudio(relative,bytes,controller.signal);
   controller.signal.throwIfAborted();
   res.end(JSON.stringify({result:true}));
  }catch(error){if(!res.writableEnded&&!res.destroyed){res.statusCode=400;res.end(JSON.stringify({error:(error as Error).message}));}}
  finally{clearTimeout(timer);req.removeListener('aborted',abort);res.removeListener('close',abort);if(admitted)busy=false;}
 };
}
