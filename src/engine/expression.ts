import type { ConditionSpec, JsonValue, ValueExpr } from "../types/stateMachine";

/**
 * Small, pure helpers used by simulate.ts to interpret the two smallest pieces of the machine
 * data format: "where does an action's value come from" (ValueExpr) and "does this transition's
 * condition match the current character" (ConditionSpec). Kept separate from simulate.ts mainly
 * because they're independently useful/testable in isolation.
 */

/** Resolves a ValueExpr to a concrete value. Never executes user-supplied code. */
export function resolveValue(
  expr: ValueExpr,
  char: string | null,
  variables: Record<string, JsonValue>
): JsonValue {
  switch (expr.kind) {
    case "char":
      return char ?? "";
    case "literal":
      return structuredClone(expr.value);
    case "var":
      return structuredClone(variables[expr.name] ?? null);
  }
}

/**
 * Whether a condition matches the current event.
 * `char` is the character being consumed, or null for the end-of-input event.
 * "else" and character conditions never match the end-of-input event: it is
 * a distinct event that only "endOfInput" conditions can catch.
 */
export function matchesCondition(condition: ConditionSpec, char: string | null): boolean {
  if (char === null) {
    return condition.type === "endOfInput";
  }
  switch (condition.type) {
    case "endOfInput":
      return false;
    case "charEquals":
      return char === condition.value;
    case "charIn":
      return condition.values.includes(char);
    case "charMatches":
      return new RegExp(condition.pattern).test(char);
    case "else":
      return true;
  }
}
