import ts from 'typescript';

import {frameTypes} from './frame-types';
import {debugLocalLimit,debugLocalNameLimit} from './debug-locals';
import {debugSourceSpanAt,type DebugSourceSpan} from './source-location';
import {meterScriptWork} from './frame-work';
import {scriptWorkStepName} from './script-execution-host';

export interface FrameDiagnostic {code:number;message:string;line:number;column:number}
export type FrameBreakpoint = {line:number;column:number};
export type DebugFunction = {name:string;points:FrameBreakpoint[];calls:number[]};
export interface CompiledFrame {
  body?:string;
  sourceMap?:string;
  /** Source-map original lines include this many synthetic wrapper lines. */
  sourceLineOffset:number;
  diagnostics:FrameDiagnostic[];
  statementLocations?:FrameBreakpoint[];
  debugSourceSpans?:DebugSourceSpan[];
  debugFunctions?:DebugFunction[];
}

/** Transpile without filesystem/module resolution or evaluation. A trusted standard-library
 * declaration string enables strict semantic checking; workers supply the bundled ES5 library.
 * Use compileFrameSourceAsync for worker isolation and a host deadline.
 */
export function compileFrameSource(source:string,standardLibrary?:string,breakpointLine?:number,standalone=false):CompiledFrame {
  const diagnostics:FrameDiagnostic[]=[];
  const fail=(message:string):CompiledFrame=>({sourceLineOffset:1,diagnostics:[{code:90001,message,line:1,column:1}]});
  if(typeof source!=='string'||new TextEncoder().encode(source).byteLength>256*1024)
    return fail('Frame source exceeds 256 KiB.');
  const wrapped=(standardLibrary!==undefined?'function __splashFrame(timeline: SplashTimeline, state: SplashState, input: SplashInput) {\n':
    'function __splashFrame(timeline: any, state: any, input: any) {\n')+source+'\n}\n';
  const file=ts.createSourceFile('frame.ts',wrapped,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
  const sourceLines=source.split(/\r\n|[\r\n\u2028\u2029]/).length;
  const add=(code:number,message:string,start=0)=>{
    if(diagnostics.length>=50)return;
    const point=file.getLineAndCharacterOfPosition(Math.min(start,wrapped.length));
    diagnostics.push({code,message:message.slice(0,2000),line:Math.max(1,Math.min(sourceLines,point.line)),column:point.character+1});
  };
  const visit=(node:ts.Node)=>{
    if(ts.isIdentifier(node)&&node.text===scriptWorkStepName)
      add(90006,'This name is reserved for the frame work limit.',node.getStart(file));
    const modifiers=ts.canHaveModifiers(node)?ts.getModifiers(node):undefined;
    if(modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword||m.kind===ts.SyntaxKind.DefaultKeyword)||ts.isImportDeclaration(node)||ts.isImportEqualsDeclaration(node)||ts.isExportDeclaration(node)||
      ts.isExportAssignment(node)||ts.isModuleDeclaration(node)||
      (ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword))
      add(90002,'Frame modules and imports are unsupported.',node.getStart(file));
    if(modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)||ts.isAwaitExpression(node)||ts.isYieldExpression(node)||ts.isForOfStatement(node)&&node.awaitModifier)
      add(90003,'Asynchronous frame syntax is unsupported.',node.getStart(file));
    ts.forEachChild(node,visit);
  };
  visit(file);
  const output=ts.transpileModule(wrapped,{
    fileName:'frame.ts',reportDiagnostics:true,
    transformers:{before:[meterScriptWork()]},
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,sourceMap:true,inlineSources:true},
  });
  for(const diagnostic of output.diagnostics??[]){
    if(diagnostic.category===ts.DiagnosticCategory.Error)
      add(diagnostic.code,ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n'),diagnostic.start);
  }
  if(file.statements.length!==1||!ts.isFunctionDeclaration(file.statements[0]))
    add(90004,'Source must remain inside one frame body.');
  if(diagnostics.length)return {sourceLineOffset:1,diagnostics};
  if(standardLibrary!==undefined){
    // Closed virtual filesystem: never use createCompilerHost/ts.sys or resolve imports.
    const library=ts.createSourceFile('lib.d.ts',standardLibrary,ts.ScriptTarget.ES2022,true);
    const declarations=standalone?frameTypes.replace(/^declare const (?:stage|splashText):.*$/gm,''):frameTypes;
    const api=ts.createSourceFile('api.d.ts',declarations,ts.ScriptTarget.ES2022,true);
    const files=new Map([['frame.ts',file],['lib.d.ts',library],['api.d.ts',api]]);
    const host:ts.CompilerHost={
      getSourceFile:name=>files.get(name),getDefaultLibFileName:()=> 'lib.d.ts',
      writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],
      getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n',
      fileExists:name=>files.has(name),readFile:name=>files.get(name)?.text,
    };
    const program=ts.createProgram(['frame.ts','lib.d.ts','api.d.ts'],{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,noLib:true,noResolve:true,
      strict:true,noUncheckedIndexedAccess:true,skipLibCheck:true,noEmit:true,
    },host);
    for(const diagnostic of program.getSemanticDiagnostics(file))
      add(diagnostic.code,ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n'),diagnostic.start);
    if(diagnostics.length)return {sourceLineOffset:1,diagnostics};
  }
  let statementLocations:FrameBreakpoint[]|undefined;
  let debugFunctions:DebugFunction[]|undefined;
  let debugSourceSpans:DebugSourceSpan[]|undefined;
  let emitted=output;
  if(breakpointLine!==undefined){
    const frame=file.statements[0] as ts.FunctionDeclaration;
    const executable=(body:ts.Block)=>body.statements.filter(node=>
      !(ts.canHaveModifiers(node)&&ts.getModifiers(node)?.some(modifier=>modifier.kind===ts.SyntaxKind.DeclareKeyword))&&
      !ts.isEmptyStatement(node)&&!ts.isTypeAliasDeclaration(node)&&!ts.isInterfaceDeclaration(node)&&
      !ts.isFunctionDeclaration(node)&&!(ts.isExpressionStatement(node)&&ts.isStringLiteral(node.expression)));
    const statements=executable(frame.body!);
    const starts=statements.map(node=>node.getStart(file));
    const first=starts.findIndex(start=>file.getLineAndCharacterOfPosition(start).line===breakpointLine);
    if(first<0){
      add(90005,'Choose the first line of an executable top-level statement.');
      return {sourceLineOffset:1,diagnostics};
    }
    type Piece=string|readonly [start:number,end:number];
    type Edit={at:number;end:number;pieces:Piece[]};
    const edits:Edit[]=[];
    function render(start:number,end:number,changes:Edit[]){
      let cursor=start;
      const pieces:Piece[]=[];
      for(const change of changes.sort((a,b)=>a.at-b.at||a.end-b.end)){
        pieces.push([cursor,change.at]);
        for(const piece of change.pieces)pieces.push(piece);
        cursor=change.end;
      }
      pieces.push([cursor,end]);
      return pieces;
    }
    function locations(scope:readonly ts.Statement[],from:number,out:Edit[],id=0,params:readonly ts.ParameterDeclaration[]=[]){
      const names=new Set<string>();
      const bindings:{name:string;reference:string;at:number}[]=[],excluded:number[]=[];
      function collect(name:ts.BindingName,at:number){
        if(ts.isIdentifier(name)){
          if(name.text==='this'||names.has(name.text))return;
          names.add(name.text);
          if(bindings.length>=debugLocalLimit||name.text.length>debugLocalNameLimit)excluded.push(at);
          else bindings.push({name:name.text,reference:name.getText(file),at});
        }else for(const element of name.elements)if(ts.isBindingElement(element))collect(element.name,at);
      }
      for(const param of params)collect(param.name,-1);
      for(const statement of scope)if(ts.isVariableStatement(statement))
        for(const declaration of statement.declarationList.declarations)collect(declaration.name,statement.getStart(file));
      // Keep readers in the first envelope. Later declarations remain uninspected until initialized.
      const readers='['+bindings.map(({name,reference})=>'['+JSON.stringify(name)+',()=>'+reference+']').join(',')+']';
      let initialized=0,omitted=0;
      return scope.slice(from).map((node,index)=>{
        const at=node.getStart(file),{line,character}=file.getLineAndCharacterOfPosition(at);
        while(initialized<bindings.length&&bindings[initialized].at<at)initialized++;
        while(omitted<excluded.length&&excluded[omitted]<at)omitted++;
        const payload=[String(index),String(initialized),String(omitted)];
        if(!index||id)payload.push(!index?readers:'null');
        if(id)payload.push(String(id));
        out.push({at,end:at,pieces:[';yield ['+payload.join(',')+']; ']});
        return {line,column:character+1};
      });
    }
    statementLocations=locations(statements,first,edits);
    const names=new Set<string>();
    const collectNames=(node:ts.Node)=>{if(ts.isIdentifier(node))names.add(node.text);ts.forEachChild(node,collectNames);};
    collectNames(file);
    let serial=0;
    function generatedName(){
      let name:string;
      do{name='__splashDebug'+serial++;}while(names.has(name));
      names.add(name);return name;
    }
    const helpers=new Map<string,ts.FunctionDeclaration|null>();
    for(const node of frame.body!.statements)if(ts.isFunctionDeclaration(node)&&node.name)
      helpers.set(node.name.text,helpers.has(node.name.text)?null:node);
    const copied=new Map<string,{original:string;debug:string;info:DebugFunction}>();
    const declarations:Piece[]=[];
    for(const [index,statement] of statements.slice(first).entries()){
      let expression:ts.Expression|undefined;
      if(ts.isReturnStatement(statement))expression=statement.expression;
      if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.length===1)
        expression=statement.declarationList.declarations[0].initializer;
      if(ts.isExpressionStatement(statement)){
        expression=statement.expression;
        if(ts.isBinaryExpression(expression)&&expression.operatorToken.kind===ts.SyntaxKind.EqualsToken)expression=expression.right;
      }
      if(!expression||!ts.isCallExpression(expression)||expression.questionDotToken||!ts.isIdentifier(expression.expression))continue;
      const name=expression.expression.text,helper=helpers.get(name);
      if(!helper?.body||helper.asteriskToken||name.length>debugLocalNameLimit)continue;
      let copy=copied.get(name);
      if(!copy){
        const body=executable(helper.body);
        if(!body.length)continue;
        const original=generatedName(),debug=generatedName(),helperEdits:Edit[]=[];
        const points=locations(body,0,helperEdits,copied.size+1,helper.parameters);
        copy={original,debug,info:{name,points,calls:[]}};
        copied.set(name,copy);
        const spelling=helper.name!.getText(file);
        declarations.push('const '+original+'='+spelling+';function* '+debug);
        for(const piece of render(helper.name!.end,helper.end,helperEdits))declarations.push(piece);
        declarations.push('\n');
      }
      copy.info.calls.push(index);
      const at=expression.getStart(file),callee=expression.expression.getText(file);
      // Preserve calls through a binding that was replaced after frame entry.
      edits.push({at,end:expression.end,pieces:['('+callee+'==='+copy.original+'?(yield* '+copy.debug,
        [expression.expression.end,expression.end],'):',[at,expression.end],')']});
    }
    if(declarations.length){
      let at=frame.body!.getStart(file)+1;
      for(const node of frame.body!.statements){
        if(!ts.isExpressionStatement(node)||!ts.isStringLiteral(node.expression))break;
        at=node.end;
      }
      edits.unshift({at,end:at,pieces:[';',...declarations]});
      debugFunctions=[...copied.values()].map(copy=>copy.info);
    }
    const generatorMark='function'.length;
    edits.push({at:generatorMark,end:generatorMark,pieces:['*']});
    const authoredStart=wrapped.indexOf('\n')+1,authoredEnd=authoredStart+source.length;
    const spans:DebugSourceSpan[]=[],chunks:string[]=[];
    let position=0;
    for(const piece of render(0,wrapped.length,edits)){
      const chunk=typeof piece==='string'?piece:wrapped.slice(...piece);
      if(typeof piece!=='string'){
        const start=Math.max(piece[0],authoredStart),end=Math.min(piece[1],authoredEnd);
        if(start<end)spans.push([position+start-piece[0],start-authoredStart,end-start]);
      }
      chunks.push(chunk);
      position+=chunk.length;
    }
    debugSourceSpans=spans;
    const instrumented=chunks.join('');
    emitted=ts.transpileModule(instrumented,{
      fileName:'frame.ts',reportDiagnostics:true,
      transformers:{before:[meterScriptWork(offset=>!!debugSourceSpanAt(spans,offset))]},
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,sourceMap:true,inlineSources:true},
    });
    if(emitted.diagnostics?.some(item=>item.category===ts.DiagnosticCategory.Error))
      return fail('This frame body could not be prepared for source debugging.');
  }
  const body=emitted.outputText+'\nreturn __splashFrame(timeline,state,input);\n';
  if(new TextEncoder().encode(body).byteLength>256*1024)return fail('Compiled frame exceeds 256 KiB.');
  return {body,sourceMap:emitted.sourceMapText,sourceLineOffset:1,diagnostics,
    ...(statementLocations?{statementLocations}:{}),...(debugFunctions?{debugFunctions}:{}),
    ...(debugSourceSpans?{debugSourceSpans}:{})};
}
