import {validateProject,type Point} from '../../document/src';
import {captureRememberedRootPresentation} from './root-motion-presentation';
import type {GroupAuthoringSource} from './group-motion-owner';
import {promoteSampledMotionFrame} from './motion-spans';
import {moveRememberedEndpointNodes,moveRememberedEndpointTangents} from './motion-junction';

/** Original sampled Bezier node ownership. Public scene/owner data is never an
 * edit source. Caller owns final live-input and document/history publication. */
export function captureRememberedNodeAuthoringFrame(readSource:()=>GroupAuthoringSource){
 const capture=captureRememberedRootPresentation(readSource);
 try{
  const source=readSource(),snapshot=structuredClone(source.project),scene=capture.scene;
  function resolveNode(layerId:string,shapeId:string,nodeIndex:number){
   const owner=capture.resolve(layerId,shapeId),shape=scene.find(t=>t.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!Number.isSafeInteger(nodeIndex)||nodeIndex<0||shape?.kind!=='bezier'||!shape.nodes?.[nodeIndex])throw new Error('Choose an original sampled Bezier node.');
   return {...owner,nodeIndex,nodeCount:shape.nodes.length};
  }
  function resolveTangent(layerId:string,shapeId:string,nodeIndex:number,part:'in'|'out'){
   const owner=resolveNode(layerId,shapeId,nodeIndex),shape=scene.find(t=>t.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!['in','out'].includes(part)||shape?.contours?.length||!shape?.nodes?.[nodeIndex]?.[part])throw new Error('Choose an existing original single-contour Bezier handle.');
   return {...owner,part};
  }
  function resolveCompoundNode(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number){
   const owner=capture.resolve(layerId,shapeId),shape=scene.find(t=>t.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!Number.isSafeInteger(contourIndex)||contourIndex<0||!Number.isSafeInteger(nodeIndex)||nodeIndex<0||shape?.kind!=='polygon'||shape.fillRule!=='evenodd'||!shape.contours?.[contourIndex]?.[nodeIndex])throw new Error('Choose an original sampled compound contour node.');
   return {...owner,contourIndex,nodeIndex,nodeCount:shape.contours[contourIndex].length,contourCount:shape.contours.length};
  }
  function resolveCompoundTangent(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,part:'in'|'out'){
   const owner=capture.resolve(layerId,shapeId),shape=scene.find(t=>t.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!Number.isSafeInteger(contourIndex)||contourIndex<0||!Number.isSafeInteger(nodeIndex)||nodeIndex<0||!['in','out'].includes(part)||shape?.kind!=='polygon'||shape.fillRule!=='evenodd'||!shape.contours?.[contourIndex]?.[nodeIndex]?.[part])throw new Error('Choose an existing original compound contour and Bezier handle.');
   return {...owner,contourIndex,nodeIndex,part,nodeCount:shape.contours[contourIndex].length,contourCount:shape.contours.length};
  }
  return {
   get scene(){return capture.scene;},
   resolveNode,
   resolveTangent,
   resolveCompoundTangent,
   resolveCompoundNode,
   prepareCompoundNodePosition(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,point:Point,options:{validate?:()=>void}={}){
    const owner=resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex),position={x:point.x,y:point.y},validate=options.validate;
    const active=()=>{resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex);validate?.();resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex);};active();
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document node coordinates.');
    const candidate=structuredClone(snapshot);
    promoteSampledMotionFrame(candidate,[layerId],owner.start,owner.end,owner.frame);
    moveRememberedEndpointNodes(candidate,owner.frame,[{layerId,shapeId,contourIndex:owner.contourIndex,nodeIndex:owner.nodeIndex,position}]);
    validateProject(candidate);active();return candidate;
   },
   prepareCompoundTangentPosition(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,part:'in'|'out',point:Point,options:{validate?:()=>void;coupled?:boolean}={}){
    const owner=resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part),position={x:point.x,y:point.y},validate=options.validate,coupled=options.coupled;
    const active=()=>{resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part);validate?.();resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part);};active();
    if(coupled!==undefined&&typeof coupled!=='boolean')throw new Error('Choose an explicit boolean tangent coupling mode.');
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document tangent coordinates.');
    const candidate=structuredClone(snapshot);
    promoteSampledMotionFrame(candidate,[layerId],owner.start,owner.end,owner.frame);
    moveRememberedEndpointTangents(candidate,owner.frame,[{layerId,shapeId,contourIndex:owner.contourIndex,nodeIndex:owner.nodeIndex,part:owner.part,position,coupled}]);
    validateProject(candidate);active();return candidate;
   },
   prepareTangentPosition(layerId:string,shapeId:string,nodeIndex:number,part:'in'|'out',point:Point,options:{validate?:()=>void;coupled?:boolean}={}){
    const owner=resolveTangent(layerId,shapeId,nodeIndex,part),position={x:point.x,y:point.y},validate=options.validate,coupled=options.coupled;
    const active=()=>{resolveTangent(layerId,shapeId,nodeIndex,part);validate?.();resolveTangent(layerId,shapeId,nodeIndex,part);};active();
    if(coupled!==undefined&&typeof coupled!=='boolean')throw new Error('Choose an explicit boolean tangent coupling mode.');
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document tangent coordinates.');
    const candidate=structuredClone(snapshot);
    promoteSampledMotionFrame(candidate,[layerId],owner.start,owner.end,owner.frame);
    moveRememberedEndpointTangents(candidate,owner.frame,[{layerId,shapeId,nodeIndex:owner.nodeIndex,part:owner.part,position,coupled}]);
    validateProject(candidate);active();return candidate;
   },
   prepareNodePosition(layerId:string,shapeId:string,nodeIndex:number,point:Point){
    const owner=resolveNode(layerId,shapeId,nodeIndex),position={x:point.x,y:point.y};
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document node coordinates.');
    const candidate=structuredClone(snapshot);
    promoteSampledMotionFrame(candidate,[layerId],owner.start,owner.end,owner.frame);
    moveRememberedEndpointNodes(candidate,owner.frame,[{layerId,shapeId,nodeIndex:owner.nodeIndex,position}]);
    validateProject(candidate);resolveNode(layerId,shapeId,nodeIndex);return candidate;
   },
   dispose(){capture.dispose();},
  };
 }catch(error){capture.dispose();throw error;}
}
