import { useEffect, useRef, useState } from "react";
import "./HueWheel.css";

/** Clock-angle in degrees (0 = straight up, clockwise positive — matches the conic-gradient wheel's own orientation) from `center` to a pointer position. */
function angleFromPointer(center: { x: number; y: number }, px: number, py: number): number {
  const dx = px - center.x;
  const dy = py - center.y;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Lazy `useState` initializer: last-saved hue under `storageKey` if there is one, otherwise `defaultHue`. */
function readStoredHue(storageKey: string, defaultHue: number): number {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? ((parsed % 360) + 360) % 360 : defaultHue;
}

interface HueWheelProps {
  storageKey: string;
  defaultHue: number;
  triggerLabel: string;
  popoverLabel: string;
  swatchStyle: React.CSSProperties;
  onHueChange: (hue: number) => void;
}

/**
 * A trigger button (showing a swatch) that opens a popover with a draggable/keyboard-operable hue
 * ring. Only owns the interaction mechanics (drag, arrow keys, open/close, focus management,
 * persistence) — what a hue actually controls is entirely up to `onHueChange`.
 */
export function HueWheel({ storageKey, defaultHue, triggerLabel, popoverLabel, swatchStyle, onHueChange }: HueWheelProps) {
  const [open, setOpen] = useState(false);
  const [hue, setHue] = useState<number>(() => readStoredHue(storageKey, defaultHue));
  const wheelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef(false);

  // Deliberately depends only on hue: onHueChange is a fresh closure each render in the callers
  // below, and re-applying it only when hue actually changes is what we want here.
  useEffect(() => {
    onHueChange(hue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hue]);

  useEffect(() => {
    if (!open) return;
    wheelRef.current?.focus();

    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function closeAndReturnFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function persistHue(value: number) {
    localStorage.setItem(storageKey, String(Math.round(value)));
  }

  function updateHueFromPointer(clientX: number, clientY: number) {
    const wheel = wheelRef.current;
    if (!wheel) return;
    const rect = wheel.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setHue(angleFromPointer(center, clientX, clientY));
  }

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateHueFromPointer(e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    updateHueFromPointer(e.clientX, e.clientY);
  }

  function handlePointerUp() {
    draggingRef.current = false;
    persistHue(hue);
  }

  function handleWheelKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 15 : 1;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = (hue + step) % 360;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = (hue - step + 360) % 360;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 359;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    setHue(next);
    persistHue(next);
  }

  function reset() {
    setHue(defaultHue);
    persistHue(defaultHue);
  }

  const knobAngleRad = (hue * Math.PI) / 180;
  const knobX = 50 + 42 * Math.sin(knobAngleRad);
  const knobY = 50 - 42 * Math.cos(knobAngleRad);

  return (
    <div className="hue-wheel" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="hue-wheel__trigger"
        onClick={() => setOpen((o) => !o)}
        title={triggerLabel}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="hue-wheel__swatch" style={swatchStyle} />
      </button>

      {open && (
        <div className="hue-wheel__popover" role="dialog" aria-label={popoverLabel}>
          <div
            className="hue-wheel__wheel focus-ring-inset"
            ref={wheelRef}
            role="slider"
            tabIndex={0}
            aria-label={popoverLabel}
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={Math.round(hue)}
            aria-valuetext={`${Math.round(hue)} degrees`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onKeyDown={handleWheelKeyDown}
          >
            <div className="hue-wheel__wheel-center" style={swatchStyle} />
            <div className="hue-wheel__knob" style={{ left: `${knobX}%`, top: `${knobY}%` }} />
          </div>
          <p className="hue-wheel__hint">Drag the ring, or focus it and use arrow keys.</p>
          <div className="hue-wheel__footer">
            <span className="hue-wheel__label">{popoverLabel}</span>
            <button type="button" onClick={reset}>
              Reset
            </button>
          </div>
          <button type="button" className="hue-wheel__done" onClick={closeAndReturnFocus}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
