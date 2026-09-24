import type { ConditionSpec, JsonValue, MachineExpr } from "../types/stateMachine";

/**
 * Small, pure helpers used by simulate.ts to interpret the two smallest pieces of the machine
 * data format: "where does an action's value come from" (MachineExpr) and "does this transition's
 * condition match the current character" (ConditionSpec). Kept separate from simulate.ts mainly
 * because they're independently useful/testable in isolation.
 */

/**
 * Evaluates a MachineExpr to a concrete value. Never executes user-supplied code: `call` only
 * ever dispatches through this hardcoded switch (never dynamic property/`Function` lookup), so
 * widening MachineExpr's `call.name` union in the schema is the only way to add a new callable —
 * this function must grow a matching `case` for it, or the branch is unreachable at the type
 * level.
 *
 * Arithmetic/comparison operators apply the real JS operator to the evaluated operands rather
 * than hand-rolling coercion rules, so `+`/`-`/`</<=` etc. behave exactly like the TypeScript this
 * was compiled from (e.g. `vars.sum + parseInt(char)` string-concatenates when `vars.sum` is a
 * string, matching the `add9` example's reliance on that).
 */
export function evaluateExpr(expr: MachineExpr, char: string | null, variables: Record<string, JsonValue>): JsonValue {
  switch (expr.kind) {
    case "char":
      return char ?? "";
    case "literal":
      return structuredClone(expr.value);
    case "var":
      return structuredClone(variables[expr.name] ?? null);
    case "call": {
      const arg = evaluateExpr(expr.args[0], char, variables);
      switch (expr.name) {
        case "parseInt":
          return parseInt(String(arg), 10);
        case "isNaN":
          // Matches real global isNaN's ToNumber-coercing semantics (as opposed to Number.isNaN,
          // which doesn't coerce) — chosen specifically because global isNaN is in lib.es5.d.ts,
          // which is all tsTypeCheck.ts's real-tsc pass loads, while Number.isNaN is ES2015+.
          return isNaN(Number(arg));
      }
      break;
    }
    case "unary":
      return !evaluateExpr(expr.operand, char, variables);
    case "binary": {
      const left = evaluateExpr(expr.left, char, variables);
      // && and || short-circuit and return whichever operand's value decided the result,
      // matching JS semantics (not necessarily a boolean) rather than forcing one to `boolean`.
      if (expr.op === "&&") return left ? evaluateExpr(expr.right, char, variables) : left;
      if (expr.op === "||") return left ? left : evaluateExpr(expr.right, char, variables);
      const right = evaluateExpr(expr.right, char, variables);
      switch (expr.op) {
        case "+":
          return typeof left === "string" || typeof right === "string" ? String(left) + String(right) : Number(left) + Number(right);
        case "-":
          return Number(left) - Number(right);
        case "*":
          return Number(left) * Number(right);
        case "/":
          return Number(left) / Number(right);
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        case "<":
          return typeof left === "string" && typeof right === "string" ? left < right : Number(left) < Number(right);
        case "<=":
          return typeof left === "string" && typeof right === "string" ? left <= right : Number(left) <= Number(right);
        case ">":
          return typeof left === "string" && typeof right === "string" ? left > right : Number(left) > Number(right);
        case ">=":
          return typeof left === "string" && typeof right === "string" ? left >= right : Number(left) >= Number(right);
      }
    }
  }
}

const CURLY_QUOTES: ReadonlySet<string> = new Set(["“", "”"]);

/**
 * Curly/"smart" quotes are a distinct character from the straight `"` a keyboard types — word
 * processors substitute them in automatically, which otherwise silently defeats a `char === '"'`
 * condition. Collapsing them onto `"` here means every machine's quote-matching conditions work
 * against both without having to spell out all three variants. Only affects condition matching:
 * the character itself (appended field content, what the UI displays for a step) stays exactly
 * what was typed.
 */
function normalizeQuoteChar(char: string): string {
  return CURLY_QUOTES.has(char) ? '"' : char;
}

/**
 * Whether a condition matches the current event.
 * `char` is the character being consumed, or null for the end-of-input event.
 * "else" and character conditions never match the end-of-input event: it is
 * a distinct event that only "endOfInput" conditions can catch.
 */
export function matchesCondition(condition: ConditionSpec, char: string | null, variables: Record<string, JsonValue>): boolean {
  if (char === null) {
    return condition.type === "endOfInput";
  }
  switch (condition.type) {
    case "endOfInput":
      return false;
    case "charEquals":
      return normalizeQuoteChar(char) === condition.value;
    case "charIn":
      return condition.values.includes(normalizeQuoteChar(char));
    case "charMatches":
      return new RegExp(condition.pattern).test(char);
    case "else":
      return true;
    case "expr":
      return Boolean(evaluateExpr(condition.expr, char, variables));
  }
}
