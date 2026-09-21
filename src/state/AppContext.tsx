import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { simulate, type SimulationResult } from "../engine/simulate";
import type { StateMachineDef } from "../types/stateMachine";
import { compileTypeScript, type CompileError, type TsSourceMap } from "../engine/tsCompiler";
import { typeCheckTypeScript, type TypeCheckError } from "../engine/tsTypeCheck";
import { loadPersistedState, savePersistedState, type PersistedState } from "./persistence";
import { example1 } from "../examples/example1";
import { example2 } from "../examples/example2";
import { example3 } from "../examples/example3";
import { add9 } from "../examples/add9";

/**
 * All app state lives in one `useReducer` here, exposed via React context. The unit of state is
 * a `Tab` (one per editor tab, built-in or custom) holding its own source text, compile/type
 * errors, compiled machine, and playback state — switching tabs is just switching which one is
 * "active" (see `AppContextValue.active`), not a separate loading step. State persists to
 * localStorage (persistence.ts) on every change and is reloaded — recompiled from source, not
 * trusted as-is — on boot; see `initialState`/`reconcileTabs`.
 */
const BUILTIN_EXAMPLES = [example1, example2, example3, add9] as const;

interface ExampleState {
  tsSourceText: string;
  tsErrors: CompileError[];
  typeErrors: TypeCheckError[];
  tsSourceMap: TsSourceMap | null;

  machine: StateMachineDef | null;

  inputString: string;
  simulation: SimulationResult | null;
  currentStepIndex: number; // -1 = initial state, before any steps have run
  isPlaying: boolean;
}

export interface Tab {
  id: string;
  name: string;
  /** Built-in tabs have a fixed name and a starter to reset to; custom tabs can be renamed/removed. */
  isCustom: boolean;
  starterSource: string | null;
  state: ExampleState;
}

interface AppState {
  activeTabId: string;
  tabs: Tab[];
}

type Action =
  | { type: "SET_ACTIVE_TAB"; id: string }
  | { type: "SET_TS_TEXT"; text: string }
  | { type: "APPLY_TS" }
  | { type: "RESET_TO_STARTER" }
  | { type: "ADD_TAB"; id: string; name: string }
  | { type: "RENAME_TAB"; id: string; name: string }
  | { type: "REMOVE_TAB"; id: string }
  | { type: "SET_INPUT"; value: string }
  | { type: "RUN" }
  | { type: "GOTO_STEP"; index: number }
  | { type: "STEP_FORWARD" }
  | { type: "STEP_BACKWARD" }
  | { type: "RESET_PLAYBACK" }
  | { type: "PLAY" }
  | { type: "PAUSE" };

/**
 * Runs both checks a tab's source goes through — the real TypeScript type-checker and this app's
 * own structural compiler — every time. They're independent and don't influence each other: a
 * structural failure doesn't skip the type-check, and a type error doesn't block compilation.
 */
function compileAndCheck(source: string): { tsErrors: CompileError[]; typeErrors: TypeCheckError[]; machine: StateMachineDef | null; tsSourceMap: TsSourceMap | null } {
  const typeErrors = typeCheckTypeScript(source);
  const result = compileTypeScript(source);
  if (!result.ok) {
    return { tsErrors: result.errors, typeErrors, machine: null, tsSourceMap: null };
  }
  return { tsErrors: [], typeErrors, machine: result.machine, tsSourceMap: result.sourceMap };
}

/** An ExampleState freshly compiled from source — used whenever a tab gets (re)loaded with real content. */
function loadedExampleState(source: string): ExampleState {
  const { tsErrors, typeErrors, machine, tsSourceMap } = compileAndCheck(source);
  return {
    tsSourceText: source,
    tsErrors,
    typeErrors,
    tsSourceMap,
    machine,
    inputString: "",
    simulation: null,
    currentStepIndex: -1,
    isPlaying: false,
  };
}

/** A tab with no source yet — the state every tab starts in until it's first opened or explicitly loaded. */
function emptyExampleState(): ExampleState {
  return {
    tsSourceText: "",
    tsErrors: [],
    typeErrors: [],
    tsSourceMap: null,
    machine: null,
    inputString: "",
    simulation: null,
    currentStepIndex: -1,
    isPlaying: false,
  };
}

/** The built-in tabs, all empty (see emptyExampleState) — what boots when there's nothing in localStorage yet. */
function defaultInitialState(): AppState {
  return {
    activeTabId: "builtin-0",
    tabs: BUILTIN_EXAMPLES.map((ex, i) => ({
      id: `builtin-${i}`,
      name: ex.tabName,
      isCustom: false,
      starterSource: ex.source,
      state: emptyExampleState(),
    })),
  };
}

/** -1 if `id` isn't one of the built-in tab ids ("builtin-0", "builtin-1", ...), otherwise its index into BUILTIN_EXAMPLES. */
function builtinIndexForId(id: string): number {
  return BUILTIN_EXAMPLES.findIndex((_, i) => `builtin-${i}` === id);
}

/** Rebuilds tabs from a persisted snapshot, recompiling each tab's source rather than trusting
 *  any persisted compiled output. Built-in tabs always take their name/starter from the current
 *  shipped examples (not from the snapshot), so an app update never leaves a tab pointing at a
 *  stale starter — only the user's actual source/input text comes from storage. */
function reconcileTabs(persisted: PersistedState): Tab[] {
  const tabs = persisted.tabs.map((pt): Tab => {
    const builtinIndex = builtinIndexForId(pt.id);
    const isBuiltin = builtinIndex !== -1;
    const state = pt.tsSourceText ? loadedExampleState(pt.tsSourceText) : emptyExampleState();
    return {
      id: pt.id,
      name: isBuiltin ? BUILTIN_EXAMPLES[builtinIndex].tabName : pt.name,
      isCustom: !isBuiltin,
      starterSource: isBuiltin ? BUILTIN_EXAMPLES[builtinIndex].source : null,
      state: { ...state, inputString: pt.inputString },
    };
  });

  // Defensive: a snapshot saved before a new built-in example shipped shouldn't hide it.
  BUILTIN_EXAMPLES.forEach((ex, i) => {
    const id = `builtin-${i}`;
    if (tabs.some((t) => t.id === id)) return;
    tabs.splice(i, 0, { id, name: ex.tabName, isCustom: false, starterSource: ex.source, state: emptyExampleState() });
  });

  return tabs;
}

/** The `useReducer` initializer: reload + recompile from localStorage if there's a valid snapshot, otherwise the default three empty built-in tabs. */
function initialState(): AppState {
  const persisted = loadPersistedState();
  if (!persisted) return defaultInitialState();
  const tabs = reconcileTabs(persisted);
  const activeTabId = tabs.some((t) => t.id === persisted.activeTabId) ? persisted.activeTabId : tabs[0].id;
  return { activeTabId, tabs };
}

/** The inverse of reconcileTabs: strips AppState down to just what persistence.ts is willing to save (see its module comment for why). */
function toPersistedState(state: AppState): PersistedState {
  return {
    version: 1,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((t) => ({
      id: t.id,
      name: t.name,
      isCustom: t.isCustom,
      tsSourceText: t.state.tsSourceText,
      inputString: t.state.inputString,
    })),
  };
}

/** Shorthand most reducer cases use: apply `updater` to the currently-active tab's ExampleState, leave every other tab untouched. */
function updateActiveTab(state: AppState, updater: (ex: ExampleState) => ExampleState): AppState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === state.activeTabId ? { ...t, state: updater(t.state) } : t)),
  };
}

/** The whole app's state transitions. See the `Action` union above for what each case does at a glance; the trickier ones have their own comments below. */
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_ACTIVE_TAB": {
      // Load a built-in tab's starter the first time it's opened, without clobbering anything
      // the user has already typed into it (switching away and back preserves edits).
      const tabs = state.tabs.map((t) => {
        if (t.id !== action.id || t.state.tsSourceText !== "" || !t.starterSource) return t;
        return { ...t, state: loadedExampleState(t.starterSource) };
      });
      return { ...state, activeTabId: action.id, tabs };
    }

    case "SET_TS_TEXT":
      return updateActiveTab(state, (ex) => ({ ...ex, tsSourceText: action.text }));

    case "APPLY_TS":
      return updateActiveTab(state, (ex) => {
        const { tsErrors, typeErrors, machine, tsSourceMap } = compileAndCheck(ex.tsSourceText);
        return {
          ...ex,
          tsErrors,
          typeErrors,
          machine: machine ?? ex.machine,
          tsSourceMap: tsSourceMap ?? ex.tsSourceMap,
          simulation: null,
          currentStepIndex: -1,
          isPlaying: false,
        };
      });

    case "RESET_TO_STARTER": {
      const active = state.tabs.find((t) => t.id === state.activeTabId);
      if (!active) return state;
      const nextState = active.starterSource ? loadedExampleState(active.starterSource) : emptyExampleState();
      return { ...state, tabs: state.tabs.map((t) => (t.id === state.activeTabId ? { ...t, state: nextState } : t)) };
    }

    case "ADD_TAB": {
      const newTab: Tab = { id: action.id, name: action.name, isCustom: true, starterSource: null, state: emptyExampleState() };
      return { ...state, tabs: [...state.tabs, newTab], activeTabId: action.id };
    }

    case "RENAME_TAB":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id && t.isCustom && action.name.trim() ? { ...t, name: action.name.trim() } : t)),
      };

    case "REMOVE_TAB": {
      const target = state.tabs.find((t) => t.id === action.id);
      if (!target || !target.isCustom) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const removingActive = state.activeTabId === action.id;
      const activeTabId = removingActive ? (tabs[tabs.length - 1]?.id ?? state.activeTabId) : state.activeTabId;
      return { ...state, tabs, activeTabId };
    }

    case "SET_INPUT":
      return updateActiveTab(state, (ex) => ({ ...ex, inputString: action.value, simulation: null, currentStepIndex: -1, isPlaying: false }));

    case "RUN":
      return updateActiveTab(state, (ex) => {
        if (!ex.machine) return ex;
        const simulation = simulate(ex.machine, ex.inputString);
        const currentStepIndex = simulation.erroredStep ? simulation.erroredStep.index : -1;
        return { ...ex, simulation, currentStepIndex, isPlaying: false };
      });

    case "GOTO_STEP":
      return updateActiveTab(state, (ex) => {
        if (!ex.simulation) return ex;
        const max = ex.simulation.steps.length - 1;
        const index = Math.max(-1, Math.min(action.index, max));
        return { ...ex, currentStepIndex: index };
      });

    case "STEP_FORWARD":
      return updateActiveTab(state, (ex) => {
        if (!ex.simulation) return ex;
        const max = ex.simulation.steps.length - 1;
        if (ex.currentStepIndex >= max) return { ...ex, isPlaying: false };
        return { ...ex, currentStepIndex: ex.currentStepIndex + 1 };
      });

    case "STEP_BACKWARD":
      return updateActiveTab(state, (ex) => {
        if (!ex.simulation) return ex;
        return { ...ex, currentStepIndex: Math.max(-1, ex.currentStepIndex - 1), isPlaying: false };
      });

    case "RESET_PLAYBACK":
      return updateActiveTab(state, (ex) => ({ ...ex, currentStepIndex: -1, isPlaying: false }));

    case "PLAY":
      return updateActiveTab(state, (ex) => {
        if (!ex.simulation || ex.currentStepIndex >= ex.simulation.steps.length - 1) return ex;
        return { ...ex, isPlaying: true };
      });

    case "PAUSE":
      return updateActiveTab(state, (ex) => ({ ...ex, isPlaying: false }));

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  activeTab: Tab;
  active: ExampleState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Wrap the app in this once, near the root — everything else reads/dispatches via useAppContext(). */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    savePersistedState(toPersistedState(state));
  }, [state]);

  const value = useMemo(() => {
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
    return { state, activeTab, active: activeTab.state, dispatch };
  }, [state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** `state`/`dispatch` for the whole reducer, plus `activeTab`/`active` as a convenience so components don't all have to re-derive "which tab is active" themselves. */
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
