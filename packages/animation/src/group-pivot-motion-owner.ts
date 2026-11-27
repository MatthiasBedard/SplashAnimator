import {validateProject,type Point} from '../../document/src';
import {captureRememberedGroupAuthoringFrame,type GroupAuthoringSource} from './group-motion-owner';
import {rememberedAuthoringPivot,setRememberedEndpointPivots} from './motion-junction';

/** Private complete original outer-group membership; caller owns publication.
 * This edits member pivot metadata at one authored junction, not group orbits. */
export function captureRememberedGroupPivotAuthoringFrame(readSource:()=>GroupAuthoringSource){
 const capture=captureRememberedGroupAuthoringFrame(readSource);
 return {
  get scene(){return capture.scene;},
  get choices(){return capture.choices;},
  resolveGroup:capture.resolveGroup,
  prepareGroupPivotPosition(layerId:string,shapeId:string,point:Point,options:{validate?:()=>void}={}){
   const owner=capture.resolveGroup(layerId,shapeId),position={x:point.x,y:point.y},validate=options.validate;
   const active=()=>{capture.resolveGroup(layerId,shapeId);validate?.();capture.resolveGroup(layerId,shapeId);};active();
   if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document group pivot coordinates.');
   const candidate=capture.prepareGroupPromotion(layerId,shapeId);
   const artwork=candidate.layers.find(layer=>layer.id===layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
   // A member already at the target stays exact; it must not prevent the other
   // original members from adopting the shared world pivot.
   const requests=owner.shapeIds.flatMap(id=>{
    const original=artwork.find(shape=>shape.id===id)!,previous=rememberedAuthoringPivot([original]);
    return previous.x===position.x&&previous.y===position.y?[]:[{layerId,shapeId:id,position}];
   });
   if(!requests.length)throw new Error('Group pivot position does not change any original member.');
   setRememberedEndpointPivots(candidate,owner.frame,requests);
   validateProject(candidate);active();return candidate;
  },
  dispose(){capture.dispose();},
 };
}
