/** Coalesces disposable synchronous work. Admission owns input validation/snapshots. */
export function createLatestFrameTask<T>(options:{
  admit:(value:T)=>T;
  run:(value:T,current:()=>boolean)=>void;
  onError:(error:unknown,value:T,current:()=>boolean)=>void;
  requestFrame:(callback:()=>void)=>number;
  cancelFrame:(handle:number)=>void;
}){
  const {admit,run,onError,requestFrame,cancelFrame}=options;
  if([admit,run,onError,requestFrame,cancelFrame].some(f=>typeof f!=='function'))throw Error('Invalid frame task dependencies.');
  type Work={value:T;revision:number};
  type Ticket={state:'waiting'|'done'|'cancelled';handle?:number};
  let revision=0,latest:Work|undefined,scheduled:Ticket|undefined,running=false,disposed=false;
  const current=(work:Work)=>!disposed&&revision===work.revision;
  const cancelNative=(handle:number)=>{try{cancelFrame(handle);}catch{/* Logical invalidation already makes any late callback inert. */}};
  const clear=()=>{revision++;latest=undefined;const ticket=scheduled;scheduled=undefined;if(ticket){ticket.state='cancelled';if(ticket.handle!==undefined)cancelNative(ticket.handle);}};
  const dispose=()=>{if(disposed)return;disposed=true;clear();};
  const report=(error:unknown,work:Work)=>{
    if(!current(work))return;
    try{onError(error,work.value,()=>current(work));}catch{dispose();}
    finally{if(current(work))revision++;}
  };
  const schedule=()=>{
    if(disposed||running||scheduled||!latest)return;
    const ticket:Ticket={state:'waiting'};scheduled=ticket;
    try{
      const handle=requestFrame(function latestFrameTask(){
        if(disposed||ticket.state!=='waiting'||scheduled!==ticket)return;
        ticket.state='done';scheduled=undefined;const work=latest;latest=undefined;
        if(!work||!current(work))return;
        running=true;
        try{run(work.value,()=>current(work));}catch(error){report(error,work);}
        finally{running=false;schedule();}
      });
      if(!Number.isSafeInteger(handle)||handle<0)throw Error('Invalid animation frame handle.');
      if(ticket.state==='waiting'&&scheduled===ticket)ticket.handle=handle;
      else if(ticket.state==='cancelled')cancelNative(handle);
    }catch(error){
      if(ticket.state==='waiting'&&scheduled===ticket){ticket.state='cancelled';scheduled=undefined;const work=latest;latest=undefined;if(work)report(error,work);}
    }
  };
  return {
    request(value:T){
      if(disposed)throw Error('Frame task is disposed.');
      const before=revision,owned=admit(value);
      if(disposed)throw Error('Frame task is disposed.');
      if(revision!==before)throw Error('Frame task changed during admission.');
      latest={value:owned,revision:++revision};schedule();
    },
    cancel(){if(!disposed)clear();},
    dispose,
  };
}
