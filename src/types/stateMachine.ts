import { z } from "zod";

/**
 * The core data model every machine in this app ultimately becomes: a plain-data description of
 * states/transitions/conditions/actions, validated with zod. Nothing here executes anything —
 * this is deliberately just data. `tsCompiler.ts` is the only thing that currently *produces* a
 * StateMachineDef (by parsing the constrained TypeScript format), and `simulate.ts` is the only
 * thing that *interprets* one. `charMatches` is a schema-level condition kind with no TypeScript
 * syntax that compiles to it — it dates from when machines could also be hand-authored as raw
 * JSON directly against this schema (since removed from the UI in favor of TypeScript-only
 * authoring), and is kept here because the schema/engine still support it even though nothing in
 * the current app produces it. The same is true of `MachineExpr`'s `call`/`binary`/`unary`
 * variants below: this schema is the actual security boundary (not just what `tsCompiler.ts`
 * happens to emit), so it — not just the compiler — must keep `call.name` a closed literal union.
 */

// A JSON-safe value: what a machine's variables are allowed to hold.
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A small, closed expression grammar shared by action values and (via the `expr` ConditionSpec
 * below) conditions: arithmetic, comparison, and boolean logic over `char`/`vars.x`/literals,
 * plus a two-member function-call allowlist (`parseInt`, `isNaN`). This is deliberately
 * not "arbitrary JS" — `call.name` is a closed literal union rather than a string, so no schema
 * change here can widen it to arbitrary dynamic dispatch; `evaluateExpr` in expression.ts must
 * keep matching it with a hardcoded switch for the same reason.
 */
export const machineExprSchema: z.ZodType<MachineExpr> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("char") }), // the character just consumed (or "" at end of input)
    z.object({ kind: z.literal("var"), name: z.string().min(1) }),
    z.object({ kind: z.literal("literal"), value: jsonValueSchema }),
    // `.length(1)`: evaluateExpr always reads `args[0]` unconditionally (parseInt/isNaN are both
    // unary) — this schema is the security boundary for hand-authored machine data, so it must
    // enforce that arity itself rather than relying on tsCompiler.ts's matching check.
    z.object({ kind: z.literal("call"), name: z.enum(["parseInt", "isNaN"]), args: z.array(machineExprSchema).length(1) }),
    z.object({ kind: z.literal("unary"), op: z.literal("!"), operand: machineExprSchema }),
    z.object({
      kind: z.literal("binary"),
      op: z.enum(["+", "-", "*", "/", "===", "!==", "<", "<=", ">", ">=", "&&", "||"]),
      left: machineExprSchema,
      right: machineExprSchema,
    }),
  ])
);
export type MachineExpr =
  | { kind: "char" }
  | { kind: "var"; name: string }
  | { kind: "literal"; value: JsonValue }
  | { kind: "call"; name: "parseInt" | "isNaN"; args: MachineExpr[] }
  | { kind: "unary"; op: "!"; operand: MachineExpr }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||";
      left: MachineExpr;
      right: MachineExpr;
    };

// A side-effect performed when a transition is taken.
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("append"), target: z.string().min(1), value: machineExprSchema }),
  z.object({ type: z.literal("push"), target: z.string().min(1), value: machineExprSchema }),
  z.object({ type: z.literal("set"), target: z.string().min(1), value: machineExprSchema }),
]);
export type ActionSpec = z.infer<typeof actionSchema>;

// The condition that decides whether a transition fires for the current character.
export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("charEquals"), value: z.string().length(1) }),
  z.object({ type: z.literal("charIn"), values: z.array(z.string().length(1)).min(1) }),
  z.object({ type: z.literal("charMatches"), pattern: z.string().min(1) }),
  z.object({ type: z.literal("endOfInput") }),
  z.object({ type: z.literal("else") }),
  // A general boolean expression, e.g. `parseInt(char) + 9 >= 10` — see MachineExpr above.
  z.object({ type: z.literal("expr"), expr: machineExprSchema }),
]);
export type ConditionSpec = z.infer<typeof conditionSchema>;

export const stateDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** When the machine enters this state, the run halts immediately and is flagged as errored. */
  isError: z.boolean().optional(),
});
export type StateDef = z.infer<typeof stateDefSchema>;

export const transitionDefSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  condition: conditionSchema,
  actions: z.array(actionSchema).default([]),
  label: z.string().optional(),
});
export type TransitionDef = z.infer<typeof transitionDefSchema>;

/** Cross-field validation beyond what the per-field schemas above can express: no duplicate ids, every from/to/startState reference an actual declared state, and any regex condition actually compiles. */
export const stateMachineDefSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    startState: z.string().min(1),
    variables: z.record(z.string(), jsonValueSchema).default({}),
    states: z.array(stateDefSchema).min(1),
    transitions: z.array(transitionDefSchema).default([]),
  })
  .superRefine((machine, ctx) => {
    const stateIds = new Set(machine.states.map((s) => s.id));
    const dupStateIds = findDuplicates(machine.states.map((s) => s.id));
    for (const id of dupStateIds) {
      ctx.addIssue({ code: "custom", message: `Duplicate state id "${id}"`, path: ["states"] });
    }

    if (!stateIds.has(machine.startState)) {
      ctx.addIssue({
        code: "custom",
        message: `startState "${machine.startState}" is not a defined state`,
        path: ["startState"],
      });
    }

    const transitionIds = new Set<string>();
    machine.transitions.forEach((t, i) => {
      if (transitionIds.has(t.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate transition id "${t.id}"`, path: ["transitions", i, "id"] });
      }
      transitionIds.add(t.id);

      if (!stateIds.has(t.from)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition "${t.id}" references unknown "from" state "${t.from}"`,
          path: ["transitions", i, "from"],
        });
      }
      if (!stateIds.has(t.to)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition "${t.id}" references unknown "to" state "${t.to}"`,
          path: ["transitions", i, "to"],
        });
      }
      if (t.condition.type === "charMatches") {
        try {
          new RegExp(t.condition.pattern);
        } catch {
          ctx.addIssue({
            code: "custom",
            message: `Transition "${t.id}" has an invalid regex pattern "${t.condition.pattern}"`,
            path: ["transitions", i, "condition", "pattern"],
          });
        }
      }
    });
  });
export type StateMachineDef = z.infer<typeof stateMachineDefSchema>;

/** Values that appear more than once in the input, deduplicated. */
function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}
