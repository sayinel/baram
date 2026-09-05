// issue 549 — finds every place a TSX source injects markup through
// dangerouslySetInnerHTML and says where the value comes from. Test helper for
// diagram-inner-html-source.test.ts; the fixtures there are its spec.
//
// Resolution is LEXICAL, by declaration shape, without the type checker: an
// identifier is followed to its innermost binding — statement-level variables,
// functions, classes, enums and imports; switch clauses; loop and catch
// bindings; then each enclosing function's parameters — outward, the way the
// language scopes it, so two components using the same name never certify
// each other.
//
// Anything the analyser cannot see into FAILS CLOSED as "opaque": a spread of
// a parameter, of an imported or non-const value, of a call's result, a
// computed key, a literal with a getter (it runs on spread) — and a const
// object literal that is referenced anywhere other than as a spread read,
// since it could have been mutated. `var` is resolved function-scoped, and the
// createElement exception is granted only to React's own import. The caller
// decides what to do with opaque sites; the scan test keeps a reviewed list of
// today's, so a new one has to be looked at.
import ts from "typescript";

const ATTR = "dangerouslySetInnerHTML";
const HOOK = "useInnerHtml";
const CREATE_ELEMENT = "createElement";
const REACT = "react";

/** literal: an inline `{ __html }` object. memo: a const bound to
 *  useInnerHtml(…) in the same function as the site. opaque: a spread (or
 *  createElement props) the analyser cannot prove free of the attribute.
 *  other: anything else — a call, a parameter, a fresh object under a
 *  memo-like name, an unresolved name, a loop or catch binding. */
export type Origin = "literal" | "memo" | "opaque" | "other";

export interface Site {
  line: number;
  origin: Origin;
  text: string;
}

/** Every injection site in `source`, in document order: JSX attributes, JSX
 *  spreads that carry (or may carry) the attribute, and createElement calls
 *  whose props do. A spread proven not to carry it is not a site. */
export function sitesOfSource(fileName: string, source: string): Site[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === ATTR
    ) {
      const init = node.initializer;
      const expr =
        init && ts.isJsxExpression(init) ? init.expression : undefined;
      out.push(site(sf, node, expr ? classifyValue(expr) : "other"));
    } else if (ts.isJsxSpreadAttribute(node)) {
      const carried = carries(node.expression, new Set());
      if (carried) out.push(site(sf, node, carried));
    } else if (ts.isCallExpression(node) && isCreateElement(node.expression)) {
      const props = node.arguments[1];
      const carried =
        props === undefined || isNullish(props)
          ? undefined
          : carries(props, new Set());
      if (carried) out.push(site(sf, node, carried));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** What `expr`, spread into an element's props, contributes: the origin of
 *  the attribute it carries, "opaque" when that cannot be decided, undefined
 *  when it is proven absent. Object literals are read in source order — a
 *  later property or spread overrides an earlier one, as at runtime. */
function carries(expr: ts.Expression, seen: Set<ts.Node>): Origin | undefined {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return carries(expr.expression, seen);
  }
  if (ts.isObjectLiteralExpression(expr)) {
    let effective: Origin | undefined;
    // A getter anywhere in the literal runs on spread and can define the
    // attribute on `this` — before OR after the property that names it — so
    // once seen it poisons the literal for good: nothing later restores trust.
    let poisoned = false;
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        if (ts.isComputedPropertyName(prop.name)) effective = "opaque";
        else if (propName(prop.name) === ATTR) {
          effective = classifyValue(prop.initializer);
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        if (prop.name.text === ATTR) effective = classifyValue(prop.name);
      } else if (ts.isSpreadAssignment(prop)) {
        const inner = carries(prop.expression, seen);
        if (inner) effective = inner;
      } else if (ts.isGetAccessorDeclaration(prop)) {
        // One named like the attribute hands React a value built on every
        // read: never a memo. Any other poisons (see above).
        if (
          !ts.isComputedPropertyName(prop.name) &&
          propName(prop.name) === ATTR
        ) {
          effective = "other";
        } else {
          poisoned = true;
        }
      } else if (
        ts.isSetAccessorDeclaration(prop) ||
        ts.isMethodDeclaration(prop)
      ) {
        // Neither runs on a spread; only one named like the attribute (or a
        // name we cannot read) can be it.
        if (ts.isComputedPropertyName(prop.name)) effective = "opaque";
        else if (propName(prop.name) === ATTR) effective = "other";
      }
    }
    if (poisoned && (effective === undefined || effective === "memo")) {
      return "opaque";
    }
    return effective;
  }
  if (ts.isIdentifier(expr)) {
    const decl = resolve(expr);
    if (!decl || seen.has(decl)) return "opaque";
    seen.add(decl);
    if (
      ts.isVariableDeclaration(decl) &&
      isConst(decl) &&
      decl.initializer &&
      onlySpreadReads(decl)
    ) {
      return carries(decl.initializer, seen);
    }
    return "opaque";
  }
  return "opaque";
}

function classifyValue(expr: ts.Expression): Origin {
  if (ts.isParenthesizedExpression(expr)) return classifyValue(expr.expression);
  if (ts.isObjectLiteralExpression(expr)) return "literal";
  if (!ts.isIdentifier(expr)) return "other";
  const decl = resolve(expr);
  if (
    decl &&
    ts.isVariableDeclaration(decl) &&
    isConst(decl) &&
    isHookCall(decl.initializer) &&
    enclosingFunction(decl) === enclosingFunction(expr)
  ) {
    return "memo";
  }
  return "other";
}

function declarationsOf(
  list: ts.VariableDeclarationList,
  name: string,
): ts.Node | undefined {
  for (const d of list.declarations) {
    const found = findBinding(d.name, name);
    if (found) return ts.isIdentifier(found) ? d : found;
  }
  return undefined;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur && !ts.isFunctionLike(cur)) cur = cur.parent;
  return cur;
}

/** The identifier itself when `binding` IS `name`; the binding element that
 *  introduces `name` inside a destructuring pattern; undefined otherwise. */
function findBinding(
  binding: ts.BindingName,
  name: string,
): ts.Node | undefined {
  if (ts.isIdentifier(binding))
    return binding.text === name ? binding : undefined;
  for (const el of binding.elements) {
    if (ts.isOmittedExpression(el)) continue;
    const found = findBinding(el.name, name);
    if (found) return el;
  }
  return undefined;
}

/** A statement list's value binding of `name`: a variable, a function, a
 *  class, an enum, or an import. */
function fromStatements(
  statements: readonly ts.Statement[],
  name: string,
): ts.Node | undefined {
  for (const st of statements) {
    if (ts.isVariableStatement(st)) {
      const found = declarationsOf(st.declarationList, name);
      if (found) return found;
    } else if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      st.name?.text === name
    ) {
      return st;
    } else if (ts.isImportDeclaration(st)) {
      const found = importBinding(st, name);
      if (found) return found;
    }
  }
  return undefined;
}

/** A `var` declaration of `name` anywhere inside `fn`'s body, nested blocks
 *  included, nested functions and classes excluded. */
function hoistedVar(fn: ts.Node, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (
      found ||
      (node !== fn && (ts.isFunctionLike(node) || ts.isClassLike(node)))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0
    ) {
      found = declarationsOf(node, name);
      if (found) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return found;
}

function importBinding(
  decl: ts.ImportDeclaration,
  name: string,
): ts.Node | undefined {
  const clause = decl.importClause;
  if (!clause) return undefined;
  if (clause.name?.text === name) return clause;
  const bindings = clause.namedBindings;
  if (!bindings) return undefined;
  if (ts.isNamespaceImport(bindings)) {
    return bindings.name.text === name ? bindings : undefined;
  }
  return bindings.elements.find((el) => el.name.text === name);
}

function isConst(decl: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(decl.parent) &&
    (decl.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

/** React's own `createElement(…)` or `React.createElement(…)`: the callee
 *  must resolve to an import from "react". A local function that merely
 *  shares the name is an ordinary call — it could mutate its argument. */
function isCreateElement(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) {
    return callee.text === CREATE_ELEMENT && isImportFrom(callee, REACT);
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === CREATE_ELEMENT &&
    ts.isIdentifier(callee.expression) &&
    isImportFrom(callee.expression, REACT)
  );
}

function isHookCall(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === HOOK
  );
}

/** `id` resolves to a binding introduced by `import … from "<module>"`. */
function isImportFrom(id: ts.Identifier, module: string): boolean {
  const decl = resolve(id);
  if (!decl) return false;
  let cur: ts.Node | undefined = decl;
  while (cur && !ts.isImportDeclaration(cur)) cur = cur.parent;
  return (
    cur !== undefined &&
    ts.isStringLiteral(cur.moduleSpecifier) &&
    cur.moduleSpecifier.text === module
  );
}

/** `null`, `void …`, or the global `undefined` — an `undefined` that resolves
 *  to a local binding is a value like any other. */
function isNullish(expr: ts.Expression): boolean {
  if (expr.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(expr)) {
    return true;
  }
  return (
    ts.isIdentifier(expr) &&
    expr.text === "undefined" &&
    resolve(expr) === undefined
  );
}

function isSpreadRead(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isJsxSpreadAttribute(parent) || ts.isSpreadAssignment(parent)) {
    return true;
  }
  return (
    ts.isCallExpression(parent) &&
    isCreateElement(parent.expression) &&
    parent.arguments[1] === id
  );
}

/** `const` fixes the binding, not the object: `props.x = …`,
 *  `Object.assign(props, …)` or handing `props` to any call can add the
 *  attribute after the literal was read. So a const object is trusted only
 *  when every other reference to the binding is a spread read — into JSX, an
 *  object literal, or createElement's props. */
function onlySpreadReads(decl: ts.VariableDeclaration): boolean {
  if (!ts.isIdentifier(decl.name)) return false;
  const name = decl.name.text;
  const scope = enclosingFunction(decl) ?? decl.getSourceFile();
  let clean = true;
  const visit = (node: ts.Node): void => {
    if (!clean) return;
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      node !== decl.name &&
      resolve(node) === decl &&
      !isSpreadRead(node)
    ) {
      clean = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return clean;
}

function propName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name)
    ? name.text
    : undefined;
}

/** Innermost declaration of `id` by lexical scope: block statements, switch
 *  clauses, loop initialisers, catch bindings, then each enclosing function's
 *  parameters, outward to the file. */
function resolve(id: ts.Identifier): ts.Node | undefined {
  const name = id.text;
  for (
    let scope: ts.Node | undefined = id.parent;
    scope;
    scope = scope.parent
  ) {
    let found: ts.Node | undefined;
    if (
      ts.isSourceFile(scope) ||
      ts.isBlock(scope) ||
      ts.isModuleBlock(scope)
    ) {
      found = fromStatements(scope.statements, name);
    } else if (ts.isCaseBlock(scope)) {
      for (const clause of scope.clauses) {
        found ??= fromStatements(clause.statements, name);
      }
    } else if (
      (ts.isForStatement(scope) ||
        ts.isForInStatement(scope) ||
        ts.isForOfStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      found = declarationsOf(scope.initializer, name);
    } else if (ts.isCatchClause(scope) && scope.variableDeclaration) {
      const b = findBinding(scope.variableDeclaration.name, name);
      if (b) found = ts.isIdentifier(b) ? scope.variableDeclaration : b;
    }
    if (!found && (ts.isFunctionLike(scope) || ts.isSourceFile(scope))) {
      // `var` is function-scoped: one declared in any nested block of this
      // function (not of a nested function) binds the name throughout it.
      found = hoistedVar(scope, name);
    }
    if (!found && ts.isFunctionLike(scope)) {
      for (const p of scope.parameters) {
        const b = findBinding(p.name, name);
        if (b) {
          found = ts.isIdentifier(b) ? p : b;
          break;
        }
      }
    }
    if (
      !found &&
      (ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) &&
      scope.name?.text === name
    ) {
      // A named function or class expression binds its own name inside its
      // body — a recursive call to it is not a call to an outer import.
      found = scope;
    }
    if (found) return found;
  }
  return undefined;
}

function site(sf: ts.SourceFile, node: ts.Node, origin: Origin): Site {
  return {
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    origin,
    text: node.getText(sf).replace(/\s+/g, " "),
  };
}
