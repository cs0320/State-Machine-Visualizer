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
 * the current app produces it.
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

// A value expression used inside actions: where does the value come from?
export const valueExprSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("char") }), // the character just consumed (or "" at end of input)
  z.object({ kind: z.literal("var"), name: z.string().min(1) }),
  z.object({ kind: z.literal("literal"), value: jsonValueSchema }),
]);
export type ValueExpr = z.infer<typeof valueExprSchema>;

// A side-effect performed when a transition is taken.
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("append"), target: z.string().min(1), value: valueExprSchema }),
  z.object({ type: z.literal("push"), target: z.string().min(1), value: valueExprSchema }),
  z.object({ type: z.literal("set"), target: z.string().min(1), value: valueExprSchema }),
]);
export type ActionSpec = z.infer<typeof actionSchema>;

// The condition that decides whether a transition fires for the current character.
export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("charEquals"), value: z.string().length(1) }),
  z.object({ type: z.literal("charIn"), values: z.array(z.string().length(1)).min(1) }),
  z.object({ type: z.literal("charMatches"), pattern: z.string().min(1) }),
  z.object({ type: z.literal("endOfInput") }),
  z.object({ type: z.literal("else") }),
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
