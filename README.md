# State Machine Visualizer

An educational tool for teaching finite state machines: define a machine in a constrained,
recognizable subset of TypeScript, run a string through it character by character, and watch
each step — the diagram, the machine's variables, and the source line that produced it, all in
sync.

Ships with three built-in examples: a progression of increasingly correct CSV parsers (naive
comma-splitting → quote-aware but no escaping → quote-aware with escaping), each demonstrating
the previous version's specific bug. State names are anonymized (`s1`, `s2`, ...) and comments are
stripped from the shipped examples deliberately — the point is for a student to work out what each
one does from its behavior, not read the answer off the state names.

## Getting started

```bash
npm install
npm run dev       # starts the dev server
```

Other scripts:

```bash
npm run build      # tsc -b && vite build — production build
npm run test        # run the test suite once
npm run test:watch  # run tests in watch mode
npm run lint         # oxlint
npm run preview      # serve the production build locally
```

## How it works

Nothing you write in the editor is ever executed. Every machine — built-in or user-written — goes
through two independent, side-effect-free passes before it can run:

1. **Structural compile** (`src/engine/tsCompiler.ts`) parses your source with `@babel/parser` and
   recognizes a specific, narrow shape: a `type State = "a" | "b" | ...;` declaration, a `vars`
   object, a `startState`, an optional `errorStates` list, and a `switch (state) { ... }` inside a
   function, where each `case` is a sequence of `if (char === ...)` rules ending in
   `return "<state>";`. Anything outside that shape is a compile error with a line number, not a
   silent failure. See `docs/typescript-format.md` for the full grammar.
2. **Real type-check** (`src/engine/tsTypeCheck.ts`) runs the same source through the actual
   TypeScript compiler (in-memory, via a custom `CompilerHost`) purely to ask "is this valid,
   type-safe TypeScript?" — independent of and in addition to the structural pass above. Neither
   pass influences the other, which is a real source of confusion worth knowing about: code can be
   perfectly valid TypeScript and still not do what you'd expect at runtime (see the `+=` on a
   `number` variable case documented in `simulate.ts`).

The structural compile succeeds into a plain-data `StateMachineDef` (`src/types/stateMachine.ts`,
validated with `zod`) — a list of states and transitions, nothing executable. `src/engine/simulate.ts`
is the only thing that *interprets* that data: it walks an input string once, character by
character, applying each transition's `set`/`append`/`push` actions, and produces the entire
step-by-step trace up front. The UI never re-runs anything when you step through playback — it's
just indexing into that precomputed array.

The diagram (`src/components/DiagramView.tsx` and friends) is React Flow with a fully custom
"floating edge" implementation: edges compute their own attachment points on the live boundary of
each node's circle every render, rather than connecting through fixed handles, which is what lets
multiple transitions between the same two states fan out instead of overlapping, and what keeps
edges correctly anchored while you drag nodes around.

State persists to `localStorage` (`src/state/persistence.ts`) on every change and is reloaded —
recompiled from source, never trusted as pre-compiled data — on boot.

## Project structure

```
src/
  engine/       Pure logic: the compiler, type-checker, simulator, and diagram geometry math.
                 No React here — see the *.test.ts files for how each piece is covered.
  types/        The StateMachineDef schema (zod) — the data format engine and UI both agree on.
  state/        The single app-wide reducer (AppContext.tsx) and localStorage persistence.
  components/   The React UI.
  examples/     The three built-in example machines' TypeScript source.
docs/
  typescript-format.md   Full reference for the recognized TypeScript grammar.
  deployment.md           How to deploy to Vercel.
```

## Testing

`npm run test` runs the Vitest suite — unit tests for the compiler, simulator, edge-geometry math,
color-contrast logic, persistence, and a resilience/fuzz suite (`src/engine/fuzz.test.ts`) that
throws malformed and pathological input at the compiler and type-checker to make sure neither ever
throws an uncaught exception (a real bug that was found and fixed this way: sufficiently deep or
repetitive syntax could overflow the real TypeScript compiler's parser stack).

There's also a top-level `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) as a last-resort
safety net — nothing in this app should throw during render, but with many independent users
typing arbitrary source, "should" isn't "can't."

## Accessibility

Built with WCAG AA in mind: keyboard-operable custom controls (the hue wheels, the panel
resizers), `aria-live` regions for errors, and — since the accent/background colors are
user-customizable via hue wheels — every color combination is verified to clear 4.5:1 text
contrast across the *entire* hue range, not just the default. See `src/engine/color.ts` and its
tests for the contrast math; a real accessibility bug in the original accent-color formula (a
handful of hues that failed contrast with any text color) was caught by that test suite.

## Contributing

- Don't add comments/descriptive names to the files in `src/examples/` — they're deliberately
  anonymized; see the top of this README for why.
- Run `npm run build && npm run test && npm run lint` before committing — all three should be
  clean.
- If you touch `src/engine/`, add or update tests alongside the change; that directory is
  correctness-critical and has been the source of several real, non-obvious bugs caught only by
  writing an actual test rather than reasoning about the code.
