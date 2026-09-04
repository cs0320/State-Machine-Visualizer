import { parse } from "@babel/parser";
import type {
  Expression,
  Node,
  ObjectExpression,
  Statement,
  TSTypeAliasDeclaration,
  VariableDeclaration,
} from "@babel/types";
import type { ActionSpec, ConditionSpec, JsonValue, StateDef, StateMachineDef, TransitionDef, ValueExpr } from "../types/stateMachine";

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface TsSourceMap {
  states: Record<string, LineRange>;
  transitions: Record<string, LineRange>;
}

export interface CompileError {
  message: string;
  line?: number;
}

export type CompileResult = { ok: true; machine: StateMachineDef; sourceMap: TsSourceMap } | { ok: false; errors: CompileError[] };

/**
 * Compiles a constrained, recognizable subset of TypeScript into a StateMachineDef:
 *
 *   type State = "a" | "b";
 *   const labels: Record<State, string> = { a: "...", b: "..." };  // optional
 *   const vars = { field: "" };
 *   const startState: State = "a";
 *   function step(state: State, char: string | null): State {
 *     switch (state) {
 *       case "a":
 *         if (char === ",") { vars.field = ""; return "a"; }
 *         if (char === null) { return "a"; }
 *         vars.field += char;
 *         return "b";
 *       case "b":
 *         ...
 *     }
 *   }
 *
 * This never executes the source: it only parses it into an AST and reads off the recognized
 * shape. Anything outside this shape is reported as a compile error with a source line.
 */
export function compileTypeScript(source: string): CompileResult {
  const errors: CompileError[] = [];

  let body: Statement[];
  try {
    const file = parse(source, { sourceType: "module", plugins: ["typescript"] });
    body = file.program.body;
  } catch (e) {
    const err = e as { message: string; loc?: { line: number } };
    return { ok: false, errors: [{ message: `Syntax error: ${err.message}`, line: err.loc?.line }] };
  }

  const stateAlias = body.find((n): n is TSTypeAliasDeclaration => n.type === "TSTypeAliasDeclaration" && n.id.name === "State");
  if (!stateAlias) {
    return { ok: false, errors: [{ message: 'Missing `type State = "a" | "b" | ...;` declaration.' }] };
  }
  const stateIds = parseStateUnion(stateAlias, errors);
  if (stateIds.length === 0) {
    errors.push({ message: "State union must list at least one state name.", line: line(stateAlias) });
  }
  const stateIdSet = new Set(stateIds);

  const labelsDecl = findVarDecl(body, "labels");
  const labels = labelsDecl ? parseLabelsObject(labelsDecl, stateIdSet, errors) : {};

  const errorStatesDecl = findVarDecl(body, "errorStates");
  const errorStateIds = errorStatesDecl ? parseErrorStates(errorStatesDecl, stateIdSet, errors) : new Set<string>();

  const varsDecl = findVarDecl(body, "vars");
  const variables = varsDecl ? parseVarsObject(varsDecl, errors) : {};
  if (!varsDecl) {
    errors.push({ message: "Missing `const vars = { ... };` declaration." });
  }

  const startStateDecl = findVarDecl(body, "startState");
  const startState = startStateDecl ? parseStartState(startStateDecl, stateIdSet, errors) : undefined;
  if (!startStateDecl) {
    errors.push({ message: 'Missing `const startState: State = "...";` declaration.' });
  }

  const stepFn = body.find((n) => n.type === "FunctionDeclaration" && n.body.body.some((s) => s.type === "SwitchStatement"));
  const switchStmt = stepFn && stepFn.type === "FunctionDeclaration" ? stepFn.body.body.find((s) => s.type === "SwitchStatement") : undefined;
  if (!switchStmt || switchStmt.type !== "SwitchStatement") {
    errors.push({ message: "Missing a function containing `switch (state) { ... }`." });
    return { ok: false, errors };
  }

  const states: StateDef[] = stateIds.map((id) => ({ id, label: labels[id] ?? id, isError: errorStateIds.has(id) || undefined }));
  const transitions: TransitionDef[] = [];
  const sourceMap: TsSourceMap = { states: {}, transitions: {} };
  const seenCaseStates = new Set<string>();

  for (const switchCase of switchStmt.cases) {
    if (!switchCase.test || switchCase.test.type !== "StringLiteral") {
      errors.push({ message: "Every `case` must match a string-literal state name.", line: line(switchCase) });
      continue;
    }
    const stateId = switchCase.test.value;
    if (!stateIdSet.has(stateId)) {
      errors.push({ message: `case "${stateId}" is not one of the declared State names.`, line: line(switchCase) });
      continue;
    }
    if (seenCaseStates.has(stateId)) {
      errors.push({ message: `Duplicate case for state "${stateId}".`, line: line(switchCase) });
      continue;
    }
    seenCaseStates.add(stateId);
    sourceMap.states[stateId] = { startLine: line(switchCase), endLine: lastLine(switchCase.consequent) ?? line(switchCase) };

    const rules = extractRules(switchCase.consequent, stateId, errors);
    rules.forEach((rule, i) => {
      if (!stateIdSet.has(rule.to)) {
        errors.push({ message: `return "${rule.to}" in case "${stateId}" is not a declared state.`, line: rule.range.endLine });
        return;
      }
      const id = `${stateId}-${i}`;
      transitions.push({ id, from: stateId, to: rule.to, condition: rule.condition, actions: rule.actions, label: rule.label });
      sourceMap.transitions[id] = rule.range;
    });
  }

  for (const id of stateIds) {
    if (!seenCaseStates.has(id)) errors.push({ message: `State "${id}" has no case in the switch statement.` });
  }

  if (errors.length > 0) return { ok: false, errors };

  const machine: StateMachineDef = {
    name: "TypeScript Machine",
    startState: startState!,
    variables,
    states,
    transitions,
  };
  return { ok: true, machine, sourceMap };
}

/** 1-indexed source line a node starts on, for error messages and the TsSourceMap. */
function line(node: Node): number {
  return node.loc?.start.line ?? 0;
}

/** Last line covered by a list of statements — used to compute a `case`'s full source range. */
function lastLine(nodes: Node[]): number | undefined {
  return nodes.at(-1)?.loc?.end.line;
}

/** Finds a top-level `const <name> = ...;` (or `let`/`var`) declaration by identifier name. */
function findVarDecl(body: Statement[], name: string): VariableDeclaration | undefined {
  return body.find(
    (n): n is VariableDeclaration => n.type === "VariableDeclaration" && n.declarations.some((d) => d.id.type === "Identifier" && d.id.name === name)
  );
}

/** Reads the state ids out of `type State = "a" | "b" | ...;` (a single member is also accepted, not just a union). */
function parseStateUnion(alias: TSTypeAliasDeclaration, errors: CompileError[]): string[] {
  const t = alias.typeAnnotation;
  const memberTypes = t.type === "TSUnionType" ? t.types : [t];
  const ids: string[] = [];
  for (const member of memberTypes) {
    if (member.type === "TSLiteralType" && member.literal.type === "StringLiteral") {
      ids.push(member.literal.value);
    } else {
      errors.push({ message: "State union members must be string literals.", line: line(alias) });
    }
  }
  return ids;
}

/** The initializer expression (the right-hand side) of a `const <name> = <init>;` declarator. */
function declaratorInit(decl: VariableDeclaration, name: string): Expression | null | undefined {
  return decl.declarations.find((d) => d.id.type === "Identifier" && d.id.name === name)?.init;
}

/** Reads `const labels: Record<State, string> = { a: "...", b: "..." };` into a state-id -> display-name map. */
function parseLabelsObject(decl: VariableDeclaration, stateIds: Set<string>, errors: CompileError[]): Record<string, string> {
  const init = declaratorInit(decl, "labels");
  const labels: Record<string, string> = {};
  if (!init || init.type !== "ObjectExpression") {
    errors.push({ message: "`labels` must be an object literal.", line: line(decl) });
    return labels;
  }
  for (const prop of init.properties) {
    if (prop.type !== "ObjectProperty" || (prop.key.type !== "Identifier" && prop.key.type !== "StringLiteral")) {
      errors.push({ message: "Invalid property in `labels`.", line: line(decl) });
      continue;
    }
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    if (!stateIds.has(key)) {
      errors.push({ message: `labels.${key} does not match a declared state.`, line: line(decl) });
      continue;
    }
    if (prop.value.type !== "StringLiteral") {
      errors.push({ message: `labels.${key} must be a string literal.`, line: line(decl) });
      continue;
    }
    labels[key] = prop.value.value;
  }
  return labels;
}

/** Reads `const errorStates: State[] = ["a", ...];` — states listed here get `isError: true` (see simulate.ts for what that does at runtime). */
function parseErrorStates(decl: VariableDeclaration, stateIds: Set<string>, errors: CompileError[]): Set<string> {
  const init = declaratorInit(decl, "errorStates");
  const result = new Set<string>();
  if (!init || init.type !== "ArrayExpression") {
    errors.push({ message: "`errorStates` must be an array literal, e.g. `[\"error\"]`.", line: line(decl) });
    return result;
  }
  for (const el of init.elements) {
    if (!el || el.type !== "StringLiteral") {
      errors.push({ message: "`errorStates` entries must be string literals.", line: line(decl) });
      continue;
    }
    if (!stateIds.has(el.value)) {
      errors.push({ message: `errorStates entry "${el.value}" does not match a declared state.`, line: line(decl) });
      continue;
    }
    result.add(el.value);
  }
  return result;
}

/**
 * Reads `const vars = { ... };` into the machine's initial variables. Each property value must
 * reduce to a plain JSON literal (see literalToJson) — no expressions, no `as` casts. The type
 * annotation some examples put on `vars` (`const vars: {...} = {...}`) is invisible to this
 * function; it only ever looks at the initializer, never the declared type.
 */
function parseVarsObject(decl: VariableDeclaration, errors: CompileError[]): Record<string, JsonValue> {
  const init = declaratorInit(decl, "vars");
  const vars: Record<string, JsonValue> = {};
  if (!init || init.type !== "ObjectExpression") {
    errors.push({ message: "`vars` must be an object literal.", line: line(decl) });
    return vars;
  }
  for (const prop of init.properties) {
    if (prop.type !== "ObjectProperty" || (prop.key.type !== "Identifier" && prop.key.type !== "StringLiteral")) {
      errors.push({ message: "Invalid property in `vars`.", line: line(decl) });
      continue;
    }
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    const value = literalToJson(prop.value as Expression, errors);
    if (value === undefined) {
      errors.push({ message: `vars.${key} must be a literal string, number, boolean, null, array, or object.`, line: line(decl) });
      continue;
    }
    vars[key] = value;
  }
  return vars;
}

/** Reads `const startState: State = "a";` — must be a string literal matching a declared state. */
function parseStartState(decl: VariableDeclaration, stateIds: Set<string>, errors: CompileError[]): string | undefined {
  const init = declaratorInit(decl, "startState");
  if (!init || init.type !== "StringLiteral") {
    errors.push({ message: "`startState` must be a string literal.", line: line(decl) });
    return undefined;
  }
  if (!stateIds.has(init.value)) {
    errors.push({ message: `startState "${init.value}" is not a declared state.`, line: line(decl) });
    return undefined;
  }
  return init.value;
}

/**
 * Recursively converts a literal expression (string/number/boolean/null, or an array/object built
 * only out of literals) into a plain JS value. Returns `undefined` for anything else — a variable
 * reference, a function call, a template literal, an `as` cast, etc. — which callers treat as
 * "this isn't a literal" rather than pushing their own error (so the same helper can be reused for
 * `vars` initial values and for literal ValueExprs inside actions, each with their own message).
 */
function literalToJson(node: Expression, errors: CompileError[]): JsonValue | undefined {
  switch (node.type) {
    case "StringLiteral":
      return node.value;
    case "NumericLiteral":
      return node.value;
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "ArrayExpression": {
      const values: JsonValue[] = [];
      for (const el of node.elements) {
        if (!el || el.type === "SpreadElement") return undefined;
        const v = literalToJson(el as Expression, errors);
        if (v === undefined) return undefined;
        values.push(v);
      }
      return values;
    }
    case "ObjectExpression": {
      const obj: Record<string, JsonValue> = {};
      for (const prop of (node as ObjectExpression).properties) {
        if (prop.type !== "ObjectProperty" || (prop.key.type !== "Identifier" && prop.key.type !== "StringLiteral")) return undefined;
        const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
        const v = literalToJson(prop.value as Expression, errors);
        if (v === undefined) return undefined;
        obj[key] = v;
      }
      return obj;
    }
    default:
      return undefined;
  }
}

// --- Case-body -> ordered transition rules -------------------------------------------------

interface Rule {
  condition: ConditionSpec;
  label: string;
  actions: ActionSpec[];
  to: string;
  range: LineRange;
}

/**
 * Walks a case's statement list, unrolling `if`/`else if`/`else` chains (and a bare trailing
 * `actions...; return "x";` tail with no `if`) into an ordered list of rules, matching the
 * "first matching condition wins" semantics the simulation engine already uses.
 */
function extractRules(statements: Statement[], stateId: string, errors: CompileError[]): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < statements.length) {
    const stmt = statements[i];
    if (stmt.type === "IfStatement") {
      i += 1;
      let current: Statement | null = stmt;
      while (current && current.type === "IfStatement") {
        const condition = analyzeCondition(current.test, errors);
        const block = current.consequent.type === "BlockStatement" ? current.consequent.body : [current.consequent];
        const parsed = extractActionsAndReturn(block, stateId, errors);
        if (condition && parsed) {
          rules.push({ condition: condition.spec, label: condition.label, actions: parsed.actions, to: parsed.to, range: parsed.range });
        }
        if (!current.alternate) {
          current = null;
        } else if (current.alternate.type === "IfStatement") {
          current = current.alternate;
        } else {
          const elseBlock = current.alternate.type === "BlockStatement" ? current.alternate.body : [current.alternate];
          const parsedElse = extractActionsAndReturn(elseBlock, stateId, errors);
          if (parsedElse) {
            rules.push({ condition: { type: "else" }, label: "otherwise", actions: parsedElse.actions, to: parsedElse.to, range: parsedElse.range });
          }
          current = null;
        }
      }
      continue;
    }
    // A bare tail (no `if`): the rest of the statements form the final "otherwise" rule.
    const parsed = extractActionsAndReturn(statements.slice(i), stateId, errors);
    if (parsed) {
      rules.push({ condition: { type: "else" }, label: "otherwise", actions: parsed.actions, to: parsed.to, range: parsed.range });
    }
    break;
  }
  return rules;
}

/**
 * Turns an `if` test expression into a ConditionSpec: `char === "x"` -> charEquals, `char === null`
 * -> endOfInput, or a chain of `char === "a" || char === "b" || ...` -> charIn. The `||` case
 * recurses on both sides and merges two charEquals/charIn results into one charIn — anything that
 * doesn't reduce to that shape (comparing something other than `char`, mixing `||` with other
 * operators, etc.) is reported as an error rather than silently ignored.
 */
function analyzeCondition(test: Expression, errors: CompileError[]): { spec: ConditionSpec; label: string } | undefined {
  if (test.type === "LogicalExpression" && test.operator === "||") {
    const left = analyzeCondition(test.left, errors);
    const right = analyzeCondition(test.right, errors);
    if (left?.spec.type === "charEquals" && right?.spec.type === "charEquals") {
      const values = [left.spec.value, right.spec.value];
      return { spec: { type: "charIn", values }, label: `char in ${JSON.stringify(values)}` };
    }
    if (left?.spec.type === "charIn" && right?.spec.type === "charEquals") {
      const values = [...left.spec.values, right.spec.value];
      return { spec: { type: "charIn", values }, label: `char in ${JSON.stringify(values)}` };
    }
    errors.push({ message: "`||` conditions must be a chain of `char === \"x\"` comparisons.", line: line(test) });
    return undefined;
  }
  if (test.type === "BinaryExpression" && (test.operator === "===" || test.operator === "==")) {
    const { left, right } = test;
    const literalSide = right.type === "StringLiteral" || right.type === "NullLiteral" ? right : left;
    const identSide = literalSide === right ? left : right;
    if (identSide.type !== "Identifier" || identSide.name !== "char") {
      errors.push({ message: "Conditions must compare `char` to a string or `null`.", line: line(test) });
      return undefined;
    }
    if (literalSide.type === "NullLiteral") {
      return { spec: { type: "endOfInput" }, label: "end of input" };
    }
    if (literalSide.type === "StringLiteral" && literalSide.value.length === 1) {
      return { spec: { type: "charEquals", value: literalSide.value }, label: `char === ${JSON.stringify(literalSide.value)}` };
    }
    errors.push({ message: "`char === ...` must compare against a single character or `null`.", line: line(test) });
    return undefined;
  }
  errors.push({ message: "Unrecognized condition; use `char === \"x\"`, `char === null`, or `a || b`.", line: line(test) });
  return undefined;
}

/**
 * Walks one rule's statement list (the body of an `if`/`else`/bare-tail branch) and requires it to
 * be zero or more recognized action statements (see analyzeAction) followed by exactly one
 * `return "<state>";` as the last statement. Returns the branch's line range alongside the parsed
 * actions/target, which extractRules attaches to the resulting Rule for the TsSourceMap.
 */
function extractActionsAndReturn(
  statements: Statement[],
  stateId: string,
  errors: CompileError[]
): { actions: ActionSpec[]; to: string; range: LineRange } | undefined {
  if (statements.length === 0) {
    errors.push({ message: `Empty branch in case "${stateId}": expected a \`return\` statement.` });
    return undefined;
  }
  const actions: ActionSpec[] = [];
  const startLine = line(statements[0]);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const isLast = i === statements.length - 1;
    if (stmt.type === "ReturnStatement") {
      if (!isLast) errors.push({ message: "`return` must be the last statement in a branch.", line: line(stmt) });
      if (!stmt.argument || stmt.argument.type !== "StringLiteral") {
        errors.push({ message: 'A branch must `return "<state>"` (a string literal).', line: line(stmt) });
        return undefined;
      }
      return { actions, to: stmt.argument.value, range: { startLine, endLine: line(stmt) } };
    }
    if (stmt.type !== "ExpressionStatement") {
      errors.push({ message: "Only `vars.x = ...`, `vars.x += char`, `vars.x.push(...)`, and `return` are supported here.", line: line(stmt) });
      return undefined;
    }
    const action = analyzeAction(stmt.expression, errors);
    if (!action) return undefined;
    actions.push(action);
  }
  errors.push({ message: `case "${stateId}" branch does not end with a \`return\` statement.`, line: line(statements.at(-1)!) });
  return undefined;
}

/**
 * Recognizes exactly three action shapes and maps each to its ActionSpec kind — `vars.x = <v>`
 * (set), `vars.x += <v>` (append), and `vars.x.push(<v>)` (push). See simulate.ts's
 * `applyActions` for what each of these actually does at runtime — notably, this function has no
 * idea what type `x` is, so it can't warn here if `+=`/`.push()` will misbehave for that variable.
 */
function analyzeAction(expr: Expression, errors: CompileError[]): ActionSpec | undefined {
  if (expr.type === "AssignmentExpression" && expr.left.type === "MemberExpression") {
    const target = memberTargetName(expr.left, errors);
    if (!target) return undefined;
    if (expr.operator === "=") {
      const value = resolveValueExpr(expr.right, errors);
      if (!value) return undefined;
      return { type: "set", target, value };
    }
    if (expr.operator === "+=") {
      const value = resolveValueExpr(expr.right, errors);
      if (!value) return undefined;
      return { type: "append", target, value };
    }
    errors.push({ message: `Unsupported assignment operator "${expr.operator}".`, line: line(expr) });
    return undefined;
  }
  if (
    expr.type === "CallExpression" &&
    expr.callee.type === "MemberExpression" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.name === "push"
  ) {
    const target = memberTargetName(expr.callee.object as Expression, errors);
    if (!target) return undefined;
    if (expr.arguments.length !== 1) {
      errors.push({ message: "`.push(...)` must take exactly one argument.", line: line(expr) });
      return undefined;
    }
    const value = resolveValueExpr(expr.arguments[0] as Expression, errors);
    if (!value) return undefined;
    return { type: "push", target, value };
  }
  errors.push({ message: "Only `vars.x = ...`, `vars.x += char`, and `vars.x.push(...)` are supported as actions.", line: line(expr) });
  return undefined;
}

/** Confirms an expression is exactly `vars.<name>` (the literal identifier `vars`) and returns `<name>`. */
function memberTargetName(node: Expression, errors: CompileError[]): string | undefined {
  if (node.type !== "MemberExpression" || node.object.type !== "Identifier" || node.object.name !== "vars" || node.property.type !== "Identifier") {
    errors.push({ message: "Expected `vars.<name>`.", line: line(node) });
    return undefined;
  }
  return node.property.name;
}

/** Resolves the right-hand side of an action to a ValueExpr: the literal identifier `char`, a `vars.y` reference, or a literal (via literalToJson). */
function resolveValueExpr(node: Expression, errors: CompileError[]): ValueExpr | undefined {
  if (node.type === "Identifier" && node.name === "char") {
    return { kind: "char" };
  }
  if (node.type === "MemberExpression") {
    const name = memberTargetName(node, errors);
    return name ? { kind: "var", name } : undefined;
  }
  const literal = literalToJson(node, errors);
  if (literal === undefined) {
    errors.push({ message: "Expected `char`, `vars.<name>`, or a literal value.", line: line(node) });
    return undefined;
  }
  return { kind: "literal", value: literal };
}
