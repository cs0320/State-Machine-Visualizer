/**
 * What actually gets saved to localStorage: authored content only (source code, input string,
 * tab identity). Everything else — compiled machine, errors, simulation trace, playback position
 * — is cheap to recompute from the source and shouldn't be persisted or versioned separately.
 */
export interface PersistedTab {
  id: string;
  name: string;
  isCustom: boolean;
  tsSourceText: string;
  inputString: string;
}

export interface PersistedState {
  version: 1;
  activeTabId: string;
  tabs: PersistedTab[];
}

const STORAGE_KEY = "smv-tabs-v1";

/** Runtime shape-check for a value read out of localStorage — never trust it just because JSON.parse succeeded. */
function isPersistedTab(value: unknown): value is PersistedTab {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.isCustom === "boolean" &&
    typeof t.tsSourceText === "string" &&
    typeof t.inputString === "string"
  );
}

/** Returns null if there's nothing saved, storage is unavailable, or the saved data doesn't match the current shape. */
export function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<PersistedState>;
    if (candidate.version !== 1 || typeof candidate.activeTabId !== "string" || !Array.isArray(candidate.tabs)) return null;
    if (candidate.tabs.length === 0 || !candidate.tabs.every(isPersistedTab)) return null;
    return candidate as PersistedState;
  } catch {
    return null;
  }
}

/** Best-effort: quota limits, disabled storage (private browsing), etc. just mean this write is skipped. */
export function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not critical — persistence is a convenience, not a requirement.
  }
}
