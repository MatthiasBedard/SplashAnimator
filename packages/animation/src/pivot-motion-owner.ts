import {validateProject,type Point} from '../../document/src';
import {captureRememberedRootPresentation} from './root-motion-presentation';
import type {GroupAuthoringSource} from './group-motion-owner';
import {promoteSampledMotionFrame} from './motion-spans';
import {setRememberedEndpointPivots} from './motion-junction';

/** Private original root ownership; caller owns final input/history publication. */
export function captureRememberedPivotAuthoringFrame(readSource:()=>GroupAuthoringSource){
 const capture=captureRememberedRootPresentation(readSource);
 try{
  const source=readSource(),snapshot=structuredClone(source.project);void capture.scene;
  const resolve=(layerId:string,shapeId:string)=>capture.resolve(layerId,shapeId);
  return {
   get scene(){return capture.scene;},resolve,
   preparePivotPosition(layerId:string,shapeId:string,point:Point,options:{validate?:()=>void}={}){
    const owner=resolve(layerId,shapeId),position={x:point.x,y:point.y},validate=options.validate;
    const active=()=>{resolve(layerId,shapeId);validate?.();resolve(layerId,shapeId);};active();
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document pivot coordinates.');
    const candidate=structuredClone(snapshot);
    promoteSampledMotionFrame(candidate,[layerId],owner.start,owner.end,owner.frame);
    setRememberedEndpointPivots(candidate,owner.frame,[{layerId,shapeId,position}]);
    validateProject(candidate);active();return candidate;
   },
   dispose(){capture.dispose();},
  };
 }catch(error){capture.dispose();throw error;}
}
