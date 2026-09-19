import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { AppProvider, useAppContext } from "./state/AppContext";
import { TsEditor } from "./components/TsEditor";
import { DiagramView } from "./components/DiagramView";
import { InputRunner } from "./components/InputRunner";
import { StateInspector } from "./components/StateInspector";
import { ColorPicker } from "./components/ColorPicker";
import { BackgroundColorPicker } from "./components/BackgroundColorPicker";
import "./App.css";

function clamp(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, width));
}

/** Lazy `useState` initializer for useResizableWidth: last-saved width if there is one and it's still in range, otherwise the default. */
function readStoredWidth(storageKey: string, min: number, max: number, defaultWidth: number): number {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : defaultWidth;
}

/**
 * A draggable/keyboard-resizable panel width, persisted to localStorage. `invert` flips which
 * direction growing the panel corresponds to — e.g. the right panel grows when its resizer is
 * dragged *left*, the opposite of the left panel.
 */
function useResizableWidth(storageKey: string, min: number, max: number, defaultWidth: number, invert: boolean) {
  const [width, setWidth] = useState(() => readStoredWidth(storageKey, min, max, defaultWidth));
  const draggingRef = useRef(false);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const delta = invert ? -e.movementX : e.movementX;
    setWidth((w) => clamp(w + delta, min, max));
  }

  function handlePointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    localStorage.setItem(storageKey, String(width));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 80 : 20;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width + (invert ? step : -step);
    else if (e.key === "ArrowRight") next = width + (invert ? -step : step);
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    const clamped = clamp(next, min, max);
    setWidth(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }

  return { width, handlePointerDown, handlePointerMove, handlePointerUp, handleKeyDown };
}

/** The app's layout: header + a 3-panel grid (editor / diagram / input+inspector) with two draggable resizers between them. Split out from `App` only so it can sit inside AppProvider and call useAppContext(). */
function AppShell() {
  const { active } = useAppContext();
  const hasError = Boolean(active.simulation?.erroredStep);

  const left = useResizableWidth("smv-left-width", 280, 720, 380, false);
  const right = useResizableWidth("smv-right-width", 280, 600, 340, true);

  return (
    <div className="app">
      <header className="app__header">
        <h1>State Machine Visualizer</h1>
        <p>Define a state machine in TypeScript, run a string through it, and watch each step.</p>
        <div className="app__header-tools">
          <a
            className="app__docs-link"
            href="https://docs.google.com/document/d/1_dBY52R75kuOEGDlTZRvQp28MRxz__yYVH0Ua2tSA38/edit?tab=t.0"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
          <BackgroundColorPicker />
          <ColorPicker />
        </div>
      </header>
      <div
        className="app__body"
        style={{ "--left-width": `${left.width}px`, "--right-width": `${right.width}px` } as CSSProperties}
      >
        <div className="app__panel app__panel--editor" role="region" aria-label="Machine editor">
          <TsEditor />
        </div>
        <div
          className="app__resizer focus-ring-inset"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor panel"
          aria-valuemin={280}
          aria-valuemax={720}
          aria-valuenow={left.width}
          tabIndex={0}
          onPointerDown={left.handlePointerDown}
          onPointerMove={left.handlePointerMove}
          onPointerUp={left.handlePointerUp}
          onKeyDown={left.handleKeyDown}
        />
        <div className="app__panel app__panel--diagram" role="region" aria-label="State diagram">
          <h2 className="sr-only">State diagram</h2>
          <DiagramView />
        </div>
        <div
          className="app__resizer focus-ring-inset"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize input panel"
          aria-valuemin={280}
          aria-valuemax={600}
          aria-valuenow={right.width}
          tabIndex={0}
          onPointerDown={right.handlePointerDown}
          onPointerMove={right.handlePointerMove}
          onPointerUp={right.handlePointerUp}
          onKeyDown={right.handleKeyDown}
        />
        <div
          className={`app__panel app__panel--right${hasError ? " app__panel--right-error" : ""}`}
          role="region"
          aria-label="Input and playback"
        >
          <InputRunner />
          <StateInspector />
        </div>
      </div>
    </div>
  );
}

/** Root component: wires up the single app-wide state provider (see AppContext.tsx) around the actual UI. */
function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

export default App;
