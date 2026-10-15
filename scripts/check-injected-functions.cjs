// executeScript sends a function's source, not its module closure, to the page.
const ts = require('typescript');
const path = require('node:path');

function checkInjectedFunctions(program, include = file => !file.isDeclarationFile && !file.fileName.endsWith('.test.ts')) {
 const checker = program.getTypeChecker(), checked = new Set(), findings = [];
 const within = (node, root) => { for (let n = node; n; n = n.parent) if (n === root) return true; return false; };
 const report = (node, message) => findings.push({ file: node.getSourceFile().fileName, line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1, message });
 const resolve = expression => {
  if (!ts.isIdentifier(expression)) return expression;
  let symbol = checker.getSymbolAtLocation(expression);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
 };
 for (const file of program.getSourceFiles().filter(include)) {
  const scan = node => {
   if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'executeScript') {
    const options = node.arguments[0];
    if (options && ts.isObjectLiteralExpression(options)) {
     const property = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText().replace(/['"]/g, '') === 'func');
     if (property) {
      const fn = resolve(property.initializer);
      if (!fn || !ts.isFunctionLike(fn) || !fn.body) report(property, 'Cannot resolve injected function; pass a concrete function.');
      else if (!checked.has(fn)) {
       checked.add(fn);
       const visit = n => {
        if (ts.isTypeNode(n)) return;
        if (ts.isFunctionLike(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) report(n, 'Injected async syntax creates an external ES2015 helper; use a self-contained Promise.');
        if (ts.isIdentifier(n)) {
         const p = n.parent;
         const propertyName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n)
          || (ts.isMethodDeclaration(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n);
         if (!propertyName) {
          const symbol = ts.isShorthandPropertyAssignment(p) ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(n);
          const declarations = symbol?.declarations || [];
          if (declarations.length && declarations.every(d => !within(d, fn)) && declarations.some(d => !d.getSourceFile().isDeclarationFile))
           report(n, `Injected function captures extension value "${n.text}". Pass data through args; translate after returning to the extension.`);
         }
        }
        ts.forEachChild(n, visit);
       };
       visit(fn);
      }
     }
    }
   }
   ts.forEachChild(node, scan);
  };
  scan(file);
 }
 return { checked: checked.size, findings };
}

function checkProject(root) {
 const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
 if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
 const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
 const program = ts.createProgram(parsed.fileNames, parsed.options);
 const result = checkInjectedFunctions(program, f => f.fileName.startsWith(path.join(root, 'src') + path.sep) && !f.fileName.endsWith('.test.ts'));
 if (!result.checked) throw new Error('No injected functions checked.');
 for (const f of result.findings) console.error(`${path.relative(root, f.file)}:${f.line}: ${f.message}`);
 if (result.findings.length) throw new Error(`${result.findings.length} unsafe injected-function references.`);
 console.log(`Injection isolation: ${result.checked} functions checked.`);
 return result;
}
if (require.main === module) checkProject(path.resolve(__dirname, '..'));
module.exports = { checkInjectedFunctions, checkProject };
