import { useEffect } from "react";
import { useAppContext } from "../state/AppContext";
import "./InputRunner.css";

const PLAY_INTERVAL_MS = 700;

/**
 * The input textarea, character-by-character preview with a read-position cursor, and playback
 * controls. "Run" computes the *entire* step-by-step trace up front (see simulate.ts) — everything
 * here (stepping, the slider, autoplay) just moves `currentStepIndex` through an already-computed
 * `simulation.steps` array, it never re-runs anything, which is why scrubbing is instant.
 */
export function InputRunner() {
  const { active, dispatch } = useAppContext();
  const { machine, inputString, simulation, currentStepIndex, isPlaying } = active;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => dispatch({ type: "STEP_FORWARD" }), PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isPlaying, dispatch]);

  const totalSteps = simulation?.steps.length ?? 0;
  const atStart = currentStepIndex === -1;
  const atEnd = !simulation || currentStepIndex >= totalSteps - 1;
  const currentStep = currentStepIndex >= 0 ? simulation?.steps[currentStepIndex] : undefined;
  const cursorPos = currentStep ? currentStep.position : 0;
  const erroredStep = simulation?.erroredStep;
  const isViewingError = Boolean(erroredStep && currentStep && currentStep.index === erroredStep.index);

  return (
    <div className="input-runner">
      <h2 id="input-runner-heading">Input</h2>
      <textarea
        className="input-runner__input"
        rows={2}
        value={inputString}
        onChange={(e) => dispatch({ type: "SET_INPUT", value: e.target.value })}
        placeholder="Type the string to run through the machine…"
        aria-labelledby="input-runner-heading"
      />

      <div className="input-runner__preview" aria-label="input with read cursor">
        {inputString.length === 0 ? (
          <span className="input-runner__empty">(empty string)</span>
        ) : (
          inputString.split("").map((ch, i) => {
            const isCursor = simulation && i === cursorPos;
            const className = isCursor
              ? `input-runner__char${isViewingError ? " input-runner__char--error" : " input-runner__char--cursor"}`
              : "input-runner__char";
            return (
              <span key={i} className={className}>
                {ch === "\n" ? "⏎" : ch}
              </span>
            );
          })
        )}
        {simulation && cursorPos >= inputString.length && (
          <span className={`input-runner__char${isViewingError ? " input-runner__char--error" : " input-runner__char--cursor"}`}>∎</span>
        )}
      </div>

      <div className="input-runner__buttons">
        <button type="button" className="primary" onClick={() => dispatch({ type: "RUN" })}>
          Run
        </button>
        <button type="button" onClick={() => dispatch({ type: "RESET_PLAYBACK" })} disabled={!simulation}>
          Reset
        </button>
      </div>

      {simulation && (
        <div className="input-runner__playback">
          <button type="button" onClick={() => dispatch({ type: "STEP_BACKWARD" })} disabled={atStart} title="Previous step" aria-label="Previous step">
            ⏮
          </button>
          {isPlaying ? (
            <button type="button" onClick={() => dispatch({ type: "PAUSE" })} title="Pause" aria-label="Pause">
              ⏸
            </button>
          ) : (
            <button type="button" onClick={() => dispatch({ type: "PLAY" })} disabled={atEnd} title="Play" aria-label="Play">
              ▶
            </button>
          )}
          <button type="button" onClick={() => dispatch({ type: "STEP_FORWARD" })} disabled={atEnd} title="Next step" aria-label="Next step">
            ⏭
          </button>
          <input
            type="range"
            className="input-runner__slider"
            min={-1}
            max={totalSteps - 1}
            value={currentStepIndex}
            onChange={(e) => dispatch({ type: "GOTO_STEP", index: Number(e.target.value) })}
            aria-label="Playback position"
            aria-valuetext={currentStepIndex === -1 ? "start, before any steps" : `step ${currentStepIndex + 1} of ${totalSteps}`}
          />
          <span className="input-runner__step-count">
            {currentStepIndex + 1} / {totalSteps}
          </span>
        </div>
      )}

      {simulation && simulation.stuck && (
        <p className="input-runner__warning" role="alert">
          The machine got stuck: no transition matched the character at position {simulation.steps.at(-1)?.position} in state "
          {simulation.steps.at(-1)?.fromState}".
        </p>
      )}

      {erroredStep && (
        <p className="input-runner__error" role="alert">
          Error: entered state "{machine?.states.find((s) => s.id === erroredStep.toState)?.label ?? erroredStep.toState}" after reading{" "}
          {erroredStep.char === null ? "end of input" : `"${erroredStep.char === "\n" ? "⏎" : erroredStep.char}"`} at position {erroredStep.position}.
          The run stopped there.
        </p>
      )}
    </div>
  );
}
