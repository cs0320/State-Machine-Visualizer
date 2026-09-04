import { matchesCondition, resolveValue } from "./expression";
import type { ActionSpec, JsonValue, StateMachineDef, TransitionDef } from "../types/stateMachine";

/**
 * The interpreter for a compiled StateMachineDef (produced by tsCompiler.ts or hand-written JSON).
 * `simulate()` never executes user code — it walks a plain-data description of states/transitions
 * and applies a small, fixed set of actions (`set`/`append`/`push`), so there's no eval/Function
 * anywhere in this path. This file is the single source of truth for what a machine actually does
 * when run; the TypeScript compiler (tsCompiler.ts) and the real tsc-based type checker
 * (tsTypeCheck.ts) both only ever validate source text — neither one influences this runtime
 * behavior, which is why an action can be valid TypeScript and still behave unexpectedly here (see
 * `applyActions`'s "append" case for the sharpest example of that gap).
 */

export interface SimStep {
  index: number;
  /** Position in the input string of the character consumed this step (input.length for the end-of-input event). */
  position: number;
  char: string | null;
  fromState: string;
  toState: string | null;
  transition: TransitionDef | null;
  variablesBefore: Record<string, JsonValue>;
  variablesAfter: Record<string, JsonValue>;
  /** True when no transition matched the event: the machine could not continue. */
  stuck: boolean;
  /** True when this step transitioned into a state flagged `isError`. */
  errored: boolean;
}

export interface SimulationResult {
  steps: SimStep[];
  finalState: string;
  finalVariables: Record<string, JsonValue>;
  /** True if the machine ran out of applicable transitions before consuming the whole input. */
  stuck: boolean;
  /** The step that entered an error state, if the run ended that way. The run stops there immediately. */
  erroredStep: SimStep | null;
}

/** First transition out of `fromState` whose condition matches the given character (or `null` for end-of-input), in declaration order. */
function findTransition(
  machine: StateMachineDef,
  fromState: string,
  char: string | null
): TransitionDef | undefined {
  return machine.transitions.find((t) => t.from === fromState && matchesCondition(t.condition, char));
}

/**
 * Applies one transition's actions to a cloned copy of `variables` (never mutates the input),
 * in order. Each action kind has a single, fixed behavior — it does not look at what type the
 * variable was declared as in the original source, only at the variable's actual current value:
 *
 * - `set`   — unconditional replace. Works correctly for any value type.
 * - `append`  — always string concatenation. If the current value isn't already a string, it's
 *   discarded (replaced with `""`) before appending — so using `append` on a variable that's
 *   currently a number silently corrupts it into a string, rather than doing numeric addition.
 * - `push`  — appends to an array. If the current value isn't already an array, it's replaced
 *   with a new single-element array — same "silently discard, don't error" shape as `append`.
 */
function applyActions(
  actions: ActionSpec[],
  char: string | null,
  variables: Record<string, JsonValue>
): Record<string, JsonValue> {
  const next = structuredClone(variables);
  for (const action of actions) {
    const value = resolveValue(action.value, char, next);
    switch (action.type) {
      case "set":
        next[action.target] = value;
        break;
      case "append": {
        const current = next[action.target];
        next[action.target] = (typeof current === "string" ? current : "") + (typeof value === "string" ? value : String(value ?? ""));
        break;
      }
      case "push": {
        const current = next[action.target];
        next[action.target] = Array.isArray(current) ? [...current, value] : [value];
        break;
      }
    }
  }
  return next;
}

/**
 * Runs a machine over an input string in one pass, producing the full step-by-step trace up
 * front (the UI just indexes into `steps` afterwards — nothing is re-run when stepping back and
 * forth through playback). Each character is one event; after the last character there's one more
 * synthetic end-of-input event (`char === null`) before the run ends.
 *
 * Two ways a run can end early, both distinct from reaching the end of input normally:
 * - `stuck: true` — no transition matched a *real* character. Recorded as a final step and halted.
 *   (No matching transition at end-of-input is not stuck — that's just "nothing more to do".)
 * - `erroredStep` — a transition led into a state flagged `isError`. The run stops immediately,
 *   without consuming any further input, even mid-string.
 */
export function simulate(machine: StateMachineDef, input: string): SimulationResult {
  const errorStateIds = new Set(machine.states.filter((s) => s.isError).map((s) => s.id));
  const steps: SimStep[] = [];
  let currentState = machine.startState;
  let variables = structuredClone(machine.variables);
  let stuck = false;
  let erroredStep: SimStep | null = null;

  for (let position = 0; position <= input.length; position++) {
    const isEndOfInput = position === input.length;
    const char = isEndOfInput ? null : input[position];
    const transition = findTransition(machine, currentState, char);

    if (!transition) {
      // For end-of-input, having no matching transition just means "stop here" (no side effect needed).
      if (!isEndOfInput) {
        stuck = true;
        steps.push({
          index: steps.length,
          position,
          char,
          fromState: currentState,
          toState: null,
          transition: null,
          variablesBefore: variables,
          variablesAfter: variables,
          stuck: true,
          errored: false,
        });
      }
      break;
    }

    const variablesBefore = variables;
    const variablesAfter = applyActions(transition.actions, char, variables);
    const entersError = errorStateIds.has(transition.to);

    const step: SimStep = {
      index: steps.length,
      position,
      char,
      fromState: currentState,
      toState: transition.to,
      transition,
      variablesBefore,
      variablesAfter,
      stuck: false,
      errored: entersError,
    };
    steps.push(step);

    variables = variablesAfter;
    currentState = transition.to;

    if (entersError) {
      // Reaching an error state ends the run immediately: don't consume any more input.
      erroredStep = step;
      break;
    }

    if (isEndOfInput) break;
  }

  return { steps, finalState: currentState, finalVariables: variables, stuck, erroredStep };
}
