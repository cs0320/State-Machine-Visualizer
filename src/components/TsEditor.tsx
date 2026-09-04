import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { useAppContext, type Tab } from "../state/AppContext";
import type { LineRange } from "../engine/tsCompiler";
import "./TsEditor.css";

/** CodeMirror extension that highlights a line range — used to show which lines of source produced the currently-active playback step (see `highlightRange` below, sourced from the compiler's TsSourceMap). */
function highlightRangeExtension(range: LineRange | null): Extension {
  return EditorView.decorations.of((view) => {
    if (!range) return Decoration.none;
    const lastLine = view.state.doc.lines;
    const ranges = [];
    for (let l = Math.max(1, range.startLine); l <= Math.min(lastLine, range.endLine); l++) {
      const lineInfo = view.state.doc.line(l);
      ranges.push(Decoration.line({ class: "cm-activeLine-transition" }).range(lineInfo.from));
    }
    const set: DecorationSet = Decoration.set(ranges, true);
    return set;
  });
}

interface TabButtonProps {
  tab: Tab;
  isActive: boolean;
  startInRename: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

/**
 * One tab in the editor's tab strip. Built-in tabs (`!tab.isCustom`) render as a plain button with
 * no rename/remove affordance at all; custom tabs get double-click-to-rename (an inline `<input>`
 * swapped in via local `renaming` state) and a remove button that confirms first if there's actual
 * content, to avoid losing work to a stray click.
 */
function TabButton({ tab, isActive, startInRename, onSelect, onRename, onRemove }: TabButtonProps) {
  const [renaming, setRenaming] = useState(startInRename);
  const [draftName, setDraftName] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function commit() {
    onRename(draftName);
    setRenaming(false);
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (tab.state.tsSourceText.trim() !== "" && !window.confirm(`Remove "${tab.name}"? This can't be undone.`)) return;
    onRemove();
  }

  return (
    <div className={`ts-editor__tab-wrapper${tab.isCustom ? " ts-editor__tab-wrapper--custom" : ""}`}>
      {renaming ? (
        <input
          ref={inputRef}
          className="ts-editor__tab-rename"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraftName(tab.name);
              setRenaming(false);
            }
          }}
          autoFocus
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          className={`ts-editor__tab${isActive ? " ts-editor__tab--active" : ""}`}
          onClick={onSelect}
          onDoubleClick={() => tab.isCustom && setRenaming(true)}
          title={tab.isCustom ? "Double-click to rename" : undefined}
        >
          {tab.name}
        </button>
      )}
      {tab.isCustom && !renaming && (
        <button type="button" className="ts-editor__tab-remove" onClick={handleRemove} aria-label={`Remove ${tab.name}`} title="Remove">
          ×
        </button>
      )}
    </div>
  );
}

/** The left panel: tab strip, CodeMirror source editor, and the two independent error panels (structural compile errors vs. real TypeScript diagnostics — see AppContext.tsx's `compileAndCheck`). */
export function TsEditor() {
  const { state, activeTab, active, dispatch } = useAppContext();
  const { tsSourceText, tsErrors, typeErrors, tsSourceMap, simulation, currentStepIndex } = active;
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const currentStep = currentStepIndex >= 0 ? simulation?.steps[currentStepIndex] : undefined;
  const highlightRange = useMemo<LineRange | null>(() => {
    if (!currentStep?.transition || !tsSourceMap) return null;
    return tsSourceMap.transitions[currentStep.transition.id] ?? null;
  }, [currentStep, tsSourceMap]);

  const extensions = useMemo(() => [javascript({ typescript: true }), highlightRangeExtension(highlightRange)], [highlightRange]);

  function addTab() {
    const id = crypto.randomUUID();
    const customCount = state.tabs.filter((t) => t.isCustom).length;
    dispatch({ type: "ADD_TAB", id, name: `Custom ${customCount + 1}` });
    setJustCreatedId(id);
  }

  return (
    <div className="ts-editor">
      <div className="ts-editor__tabs" role="tablist" aria-label="Example machine">
        {state.tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === state.activeTabId}
            startInRename={tab.id === justCreatedId}
            onSelect={() => dispatch({ type: "SET_ACTIVE_TAB", id: tab.id })}
            onRename={(name) => dispatch({ type: "RENAME_TAB", id: tab.id, name })}
            onRemove={() => dispatch({ type: "REMOVE_TAB", id: tab.id })}
          />
        ))}
        <button type="button" className="ts-editor__tab-add" onClick={addTab} aria-label="Add new example" title="Add new example">
          +
        </button>
      </div>

      <div className="ts-editor__toolbar">
        <div className="ts-editor__buttons">
          <button type="button" onClick={() => dispatch({ type: "RESET_TO_STARTER" })}>
            {activeTab.isCustom ? "Clear" : "Reset to starter"}
          </button>
          <button type="button" className="primary" onClick={() => dispatch({ type: "APPLY_TS" })}>
            Apply
          </button>
        </div>
      </div>

      <div className="ts-editor__codemirror">
        <CodeMirror
          value={tsSourceText}
          height="100%"
          theme="dark"
          extensions={extensions}
          onChange={(text) => dispatch({ type: "SET_TS_TEXT", text })}
        />
      </div>

      {tsErrors.length > 0 && (
        <div className="ts-editor__errors" role="alert">
          <h3>Machine definition errors</h3>
          <ul>
            {tsErrors.map((err, i) => (
              <li key={i}>
                {err.line ? `Line ${err.line}: ` : ""}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {typeErrors.length > 0 && (
        <div className="ts-editor__errors ts-editor__errors--type" role="alert">
          <h3>TypeScript errors</h3>
          <ul>
            {typeErrors.map((err, i) => (
              <li key={i}>
                {err.line ? `Line ${err.line}: ` : ""}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
