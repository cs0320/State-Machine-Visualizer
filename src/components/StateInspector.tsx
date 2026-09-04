import { useAppContext } from "../state/AppContext";
import type { JsonValue } from "../types/stateMachine";
import type { SimStep } from "../engine/simulate";
import "./StateInspector.css";

/** Human-readable form of a step's `char` — `null` (end-of-input) and a couple of easily-invisible characters get spelled out rather than printed raw. */
function formatChar(char: string | null): string {
  if (char === null) return "(end of input)";
  if (char === "\n") return "'\\n'";
  if (char === ",") return "','";
  return `'${char}'`;
}

/** A variable's value as it should appear in the table — just JSON, so strings/arrays/objects/numbers all read unambiguously. */
function formatValue(value: JsonValue): string {
  return JSON.stringify(value);
}

/** Renders the current `vars`, highlighting whichever keys changed on the selected step (see `changedKeysOf`). */
function VariablesTable({ variables, changedKeys }: { variables: Record<string, JsonValue>; changedKeys: Set<string> }) {
  const keys = Object.keys(variables);
  if (keys.length === 0) return <p className="state-inspector__muted">No variables defined.</p>;
  return (
    <table className="state-inspector__vars">
      <tbody>
        {keys.map((key) => (
          <tr key={key} className={changedKeys.has(key) ? "state-inspector__vars-row--changed" : undefined}>
            <th scope="row" className="state-inspector__vars-key">
              {key}
            </th>
            <td className="state-inspector__vars-value">{formatValue(variables[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Which variable names differ between two snapshots (compared by JSON equality, since values can be arrays/objects). */
function changedKeysOf(before: Record<string, JsonValue>, after: Record<string, JsonValue>): Set<string> {
  const keys = new Set<string>();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) keys.add(key);
  }
  return keys;
}

/** One line in the History list: what was read and which transition it triggered (or that it got stuck). */
function historyLabel(step: SimStep): string {
  if (step.stuck) return `stuck at ${formatChar(step.char)}`;
  return `${formatChar(step.char)} → ${step.transition?.label ?? step.transition?.id ?? "?"}`;
}

/** The right-hand "what's happening right now" panel: current step's from/to/read-character, the live `vars`, and a clickable step history (each entry jumps playback straight to that step via GOTO_STEP). */
export function StateInspector() {
  const { active, dispatch } = useAppContext();
  const { machine, simulation, currentStepIndex } = active;

  if (!machine) return <div className="state-inspector">No machine loaded.</div>;

  if (!simulation) {
    return (
      <div className="state-inspector">
        <h2>Step details</h2>
        <p className="state-inspector__muted">Run an input string to see the machine execute step by step.</p>
        <h2>Initial variables</h2>
        <VariablesTable variables={machine.variables} changedKeys={new Set()} />
      </div>
    );
  }

  const step = currentStepIndex >= 0 ? simulation.steps[currentStepIndex] : undefined;
  const variables = step ? step.variablesAfter : machine.variables;
  const changed = step ? changedKeysOf(step.variablesBefore, step.variablesAfter) : new Set<string>();

  return (
    <div className="state-inspector">
      <h2>Step details</h2>
      {!step ? (
        <p className="state-inspector__muted">
          Initial state: <strong>{machine.states.find((s) => s.id === machine.startState)?.label}</strong>. Nothing consumed yet.
        </p>
      ) : (
        <dl className="state-inspector__facts">
          <dt>Read</dt>
          <dd>{formatChar(step.char)}</dd>
          <dt>From</dt>
          <dd>{machine.states.find((s) => s.id === step.fromState)?.label ?? step.fromState}</dd>
          <dt>To</dt>
          <dd>{step.toState ? machine.states.find((s) => s.id === step.toState)?.label ?? step.toState : "(stuck — no transition)"}</dd>
          <dt>Transition</dt>
          <dd>{step.transition?.label ?? step.transition?.id ?? "—"}</dd>
        </dl>
      )}

      <h2>Variables</h2>
      <VariablesTable variables={variables} changedKeys={changed} />

      <h2>History</h2>
      <ol className="state-inspector__history">
        <li>
          <button
            type="button"
            className={currentStepIndex === -1 ? "state-inspector__history-item--active" : undefined}
            aria-current={currentStepIndex === -1 ? "step" : undefined}
            onClick={() => dispatch({ type: "GOTO_STEP", index: -1 })}
          >
            (start)
          </button>
        </li>
        {simulation.steps.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              className={i === currentStepIndex ? "state-inspector__history-item--active" : undefined}
              aria-current={i === currentStepIndex ? "step" : undefined}
              onClick={() => dispatch({ type: "GOTO_STEP", index: i })}
            >
              {i + 1}. {historyLabel(s)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
