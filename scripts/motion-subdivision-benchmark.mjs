// Comparative CPU observation only: no timing assertion or resource certification.
import {createServer} from 'vite';
import {deepStrictEqual} from 'node:assert';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
const server=await createServer({configFile:'apps/editor/vite.config.ts',server:{middlewareMode:true}});
try{
 const {editSymbolBasicMotionSpan}=await server.ssrLoadModule(resolve('packages/animation/src/motion-spans.ts'));
 const {subdividePreservedSymbolMotionSpan}=await server.ssrLoadModule(resolve('packages/animation/src/motion-subdivide.ts'));
 const shape={id:'art',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 const d={id:'bench',name:'Bench',width:100,height:100,shapes:[shape],timeline:{duration:65,keys:[{frame:64,shapes:[{...shape,x:64}]}],layers:[{id:'untouched',name:'Untouched',visible:true,locked:false,keys:[{frame:0,shapes:Array.from({length:4000},(_,i)=>({...shape,id:'still-'+i}))}]}]}};
 const source=editSymbolBasicMotionSpan(d,['@base'],0,64,'create');const cuts=Array.from({length:15},(_,i)=>(i+1)*4);
 const previous=()=>{let result=source;const pending=[{start:0,end:64,lo:0,hi:cuts.length}];while(pending.length){const s=pending.pop();if(s.lo===s.hi)continue;const mid=Math.floor((s.lo+s.hi)/2),cut=cuts[mid];result=editSymbolBasicMotionSpan(result,['@base'],s.start,s.end,'split','linear',[source],undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,cut,true);pending.push({start:cut,end:s.end,lo:mid+1,hi:s.hi},{start:s.start,end:cut,lo:s.lo,hi:mid});}return result;};
 const current=()=>subdividePreservedSymbolMotionSpan(source,['@base'],0,64,cuts);
 const oldResult=previous(),newResult=current();
 // New right-half recipe UUIDs differ on every invocation; retain/check the original ID.
 deepStrictEqual(newResult.timeline.motionSpans[0].id,source.timeline.motionSpans[0].id);
 for(const result of [oldResult,newResult])result.timeline.motionSpans.slice(1).forEach((span,i)=>{span.id='generated-'+i;});
 deepStrictEqual(newResult,oldResult);
 const results={previous:[],current:[]};for(let i=0;i<9;i++)for(const [name,run] of (i%2?[['current',current],['previous',previous]]:[['previous',previous],['current',current]])){const start=performance.now();run();if(i>1)results[name].push(performance.now()-start);}
 for(const values of Object.values(results))values.sort((a,b)=>a-b);
 console.log(JSON.stringify({fixture:'65 keys, 15 cuts, 4000 unaffected shapes',samples:7,medianMs:{previous:results.previous[3],current:results.current[3]},rangesMs:results},null,2));
}finally{await server.close();}
