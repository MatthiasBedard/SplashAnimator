import ts from 'typescript';
import { scriptWorkStepName } from './script-execution-host';

/** Charge authored loop iterations and function entries in both compiler modes. */
export const meterScriptWork = (isAuthored = (_offset: number) => true): ts.TransformerFactory<ts.SourceFile> => (context) => {
  const { factory } = context;
  let file: ts.SourceFile;
  function charge(kind: 'loop' | 'enter' | 'leave') {
    return factory.createExpressionStatement(factory.createCallExpression(
      factory.createIdentifier(scriptWorkStepName), undefined, [factory.createStringLiteral(kind)],
    ));
  }
  function meter(body: ts.Statement): ts.Block {
    return ts.isBlock(body)
      ? factory.updateBlock(body, [charge('loop'), ...body.statements])
      : factory.createBlock([charge('loop'), body], true);
  }
  function meterFunction(body: ts.ConciseBody): ts.Block {
    if (!ts.isBlock(body)) body = factory.createBlock([factory.createReturnStatement(body)], true);
    let directives = 0;
    for (const statement of body.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      directives++;
    }
    return factory.updateBlock(body, [
      ...body.statements.slice(0, directives),
      charge('enter'),
      factory.createTryStatement(
        factory.createBlock(body.statements.slice(directives), true), undefined,
        factory.createBlock([charge('leave')], true),
      ),
    ]);
  }
  const visit: ts.Visitor = (input) => {
    const node = ts.visitEachChild(input, visit, context);
    if (ts.isWhileStatement(node)) return factory.updateWhileStatement(node, node.expression, meter(node.statement));
    if (ts.isDoStatement(node)) return factory.updateDoStatement(node, meter(node.statement), node.expression);
    if (ts.isForStatement(node)) return factory.updateForStatement(node, node.initializer, node.condition, node.incrementor, meter(node.statement));
    if (ts.isForInStatement(node)) return factory.updateForInStatement(node, node.initializer, node.expression, meter(node.statement));
    if (ts.isForOfStatement(node)) return factory.updateForOfStatement(node, node.awaitModifier, node.initializer, node.expression, meter(node.statement));
    if (!ts.isFunctionLike(node) || !('body' in node) || !node.body || !isAuthored(node.body.getStart(file))) return node;
    if (ts.isFunctionDeclaration(node) && node.body)
      return factory.updateFunctionDeclaration(node,node.modifiers,node.asteriskToken,node.name,node.typeParameters,node.parameters,node.type,meterFunction(node.body));
    if (ts.isFunctionExpression(node))
      return factory.updateFunctionExpression(node,node.modifiers,node.asteriskToken,node.name,node.typeParameters,node.parameters,node.type,meterFunction(node.body));
    if (ts.isArrowFunction(node))
      return factory.updateArrowFunction(node,node.modifiers,node.typeParameters,node.parameters,node.type,node.equalsGreaterThanToken,meterFunction(node.body));
    if (ts.isMethodDeclaration(node) && node.body)
      return factory.updateMethodDeclaration(node,node.modifiers,node.asteriskToken,node.name,node.questionToken,node.typeParameters,node.parameters,node.type,meterFunction(node.body));
    if (ts.isConstructorDeclaration(node) && node.body)
      return factory.updateConstructorDeclaration(node,node.modifiers,node.parameters,meterFunction(node.body));
    if (ts.isGetAccessorDeclaration(node) && node.body)
      return factory.updateGetAccessorDeclaration(node,node.modifiers,node.name,node.parameters,node.type,meterFunction(node.body));
    if (ts.isSetAccessorDeclaration(node) && node.body)
      return factory.updateSetAccessorDeclaration(node,node.modifiers,node.name,node.parameters,meterFunction(node.body));
    return node;
  };
  // The compiler frame wrapper is synthetic. Meter its descendants only.
  return (source) => {
    file = source;
    return ts.visitEachChild(source,
      (node) => ts.isFunctionDeclaration(node) ? ts.visitEachChild(node, visit, context) : node, context);
  };
};
