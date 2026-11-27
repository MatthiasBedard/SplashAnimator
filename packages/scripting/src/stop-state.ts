import type {ScriptStateStop,ScriptStateComparison} from './session';
/** Inspector text is JSON data, never JavaScript. Preserve literal keys, including dots
 * and slashes, by requiring an explicit string array instead of a dotted expression. */
export function parseScriptStateStop(pathText:string,valueText:string,comparison?:'equals'|'changed'|ScriptStateComparison):ScriptStateStop{
 if(typeof pathText!=='string'||typeof valueText!=='string'||pathText.length>16384||valueText.length>8192)throw new Error('State condition text exceeds its limit.');
 const operation=arguments.length<3?'equals':comparison;
 let path:unknown,equals:unknown;
 try{path=JSON.parse(pathText);if(operation!=='changed')equals=JSON.parse(valueText);}catch{throw new Error('Use a JSON string array for the state path and a JSON primitive for its value.');}
 if(!Array.isArray(path)||path.length<1||path.length>16||path.some(key=>typeof key!=='string'||key.length>128||['__proto__','prototype','constructor'].includes(key)))throw new Error('State path requires 1 to 16 supported string keys (128 characters each).');
 if(operation==='changed')return {path,changed:true};
 if(!(equals===null||typeof equals==='boolean'||typeof equals==='number'&&Number.isFinite(equals)||typeof equals==='string'&&equals.length<=1024))throw new Error('State value must be null, boolean, finite number or a string of at most 1024 characters.');
 if(operation==='equals')return {path,equals};
 if(typeof operation!=='string'||!['lt','lte','gt','gte'].includes(operation)||typeof equals!=='number'||!Number.isFinite(equals))throw new Error('Numeric comparison requires a finite JSON number.');
 return {path,comparison:operation as ScriptStateComparison,value:equals};
}
