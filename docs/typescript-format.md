# Writing a state machine in TypeScript

The editor does **not** execute your code. It parses it into a syntax tree and reads a specific,
recognizable shape out of it (see `src/engine/tsCompiler.ts`), then hands the result to the
simulation engine as plain data (states/transitions/conditions/actions). Anything outside the
shape described here is reported as a compile error with a line number, instead of silently
running.

Because nothing is executed, there is no `console.log`, no imports, no arbitrary logic — only the
constructs listed below are understood.

The app also runs your source through the real TypeScript compiler's syntax and type checker
(`src/engine/tsTypeCheck.ts`) — independent of the structural checks above, this catches things
like a wrong-typed `startState` or a `return` of a state name that doesn't exist, using
TypeScript's own type checker rather than our grammar walk. Nothing is executed there either; it's
the same "is this valid, type-safe TypeScript" check your editor's red squiggles would give you.
Both sets of errors — structural and TypeScript's own — show up under the editor, in separate
panels.

The **Example 1 / 2 / 3** tabs are a built-in walkthrough: three CSV parsers of increasing
sophistication (naive comma-splitting → quote-aware but no escaping → quote-aware with escaping),
each demonstrating the previous one's specific gap. Each tab keeps its own source, errors, and
playback state independently, and starts empty — click **Reset to starter** on a tab to load its
example.

## Required pieces

A valid machine needs all four of these, in any order:

### 1. `type State = "a" | "b" | ...;`

A union of string literals naming every state. This is required even if you also have a `switch` —
it's the source of truth for the state list (and its order sets the order states are laid out in
the diagram).

```ts
type State = "startOfField" | "insideField";
```

### 2. `const vars = { ... };`

An object literal giving each variable its initial value. Values may only be literals: strings,
numbers, booleans, `null`, arrays of literals, or objects of literals (i.e. anything valid JSON).

```ts
const vars: { field: string; record: string[] } = {
  field: "",
  record: [],
};
```

Don't add `as` type-cast expressions to these values (e.g. `[] as string[]`) — the compiler reads
literals structurally and doesn't unwrap type assertions, so a cast value fails to parse.

If a variable starts out as an empty array, annotate the whole `vars` declarator's type as shown
above. Without it, TypeScript's `strict` mode infers an empty array literal as `never[]`, and the
real type checker (see below) will flag every later `vars.x.push(...)` as an error — not because
anything is wrong, just because there's no type information to work from. The annotation on the
declarator gives it that information; it doesn't change what the structural compiler reads (which
only ever looks at the initializer values, never the type annotation).

### 3. `const startState: State = "a";`

A string literal naming the state the machine starts in. Must be one of the names declared in
`State`.

### 4. A function containing `switch (state) { ... }`

One `case` per declared state (no missing states, no duplicates), each matched by a string
literal:

```ts
function step(state: State, char: string | null): State {
  switch (state) {
    case "startOfField":
      // ...
    case "insideField":
      // ...
  }
}
```

## Optional: `const labels`

Human-readable names for the diagram, keyed by state:

```ts
const labels: Record<State, string> = {
  startOfField: "Start of Field",
  insideField: "Inside Field",
};
```

If omitted, the state's identifier (e.g. `startOfField`) is used as its label.

## Optional: `const errorStates`

An array naming states that represent a parse failure:

```ts
const errorStates: State[] = ["error"];
```

`"error"` still needs to be a name in `type State` and still needs its own `case` in the
`switch` (every declared state must have exactly one, no exceptions) — this array is purely a
flag on top of an otherwise ordinary state. What it changes: the moment a transition enters a
state listed here, the run **stops immediately** — no further input is consumed, even mid-string
— and the app surfaces it as an error: the offending character is highlighted in the input
preview, the line that produced the transition is highlighted in the editor, and a red banner
names the state and the character/position that triggered it.

This is the "error is just another state" pattern — model a parse failure as a real destination
state (typically an absorbing one, i.e. it just loops back to itself for anything further) instead
of bolting on special syntax:

```ts
type State = "reading" | "error";

const errorStates: State[] = ["error"];

const labels: Record<State, string> = {
  reading: "Reading",
  error: "Error: Unexpected Character",
};

const startState: State = "reading";

const vars = { text: "" };

function step(state: State, char: string | null): State {
  switch (state) {
    case "reading":
      if (char === null) {
        return "reading";
      }
      if (char === "!") {
        return "error";
      }
      vars.text += char;
      return "reading";

    case "error":
      return "error";
  }
}
```

## Writing a `case` body

Each case body is a sequence of **rules**, checked in the order they're written — the first one
whose condition matches wins, exactly like a normal `if`/`else if`/`else` chain. A rule is either:

- **`if (condition) { ...actions; return "target"; }`**, optionally continued with `else if` /
  `else`, or
- a **bare trailing block** with no `if` — `...actions; return "target";` — which matches
  anything not caught by the `if`s above it (an implicit "otherwise").

You can mix these: any number of `if` statements in a row, and the case body may end with one bare
`return` block as the catch-all.

```ts
case "startOfField":
  if (char === ",") {
    vars.record.push(vars.field);
    vars.field = "";
    return "startOfField";
  }
  if (char === null) {
    // end of input
    return "startOfField";
  }
  vars.field += char;
  return "insideField";
```

Every branch **must** end with a `return "<state>";` — a string literal matching a declared state
— as its last statement.

### Conditions

| Form | Meaning |
| --- | --- |
| `char === "x"` (or `"x" === char`) | matches the single character `"x"` |
| `char === null` | matches end-of-input (there is no more input to read) |
| `char === "a" || char === "b" || ...` | matches any character in the list |
| *(no `if` — a bare trailing block)* | matches anything not already matched above |

`char` is the character currently being read (or `null` at end-of-input — always check this
explicitly if you need end-of-input behavior, since a plain trailing/bare rule matches real
characters only, not end-of-input). Only `===`/`==` comparisons against `char` are recognized;
there's no regex support and no `!==`.

### Actions

Statements before the `return` in a branch. Only these forms are recognized:

| Form | Meaning |
| --- | --- |
| `vars.x = <value>;` | set `vars.x` to `<value>` |
| `vars.x += char;` | append the current character onto string `vars.x` |
| `vars.x.push(<value>);` | push `<value>` onto array `vars.x` |

Where `<value>` is one of:

- `char` — the current character
- `vars.y` — another variable's current value
- a literal (string, number, boolean, `null`, or an array/object literal of literals)

There's no arithmetic, ternaries, template literals, or function calls other than `.push()` — e.g.
`vars.count += 1` is **not** supported (`+=` only makes sense for building up strings here); model
counters as strings/arrays, or track them as a literal you `set` explicitly.

## What's not supported

- Loops, recursion, or any control flow besides `if`/`else if`/`else`
- More than one `switch (state)` block, or a `switch` on anything other than the character
- Arithmetic/comparison operators besides `===`/`==` in conditions
- Numeric increment/decrement (`+=` on numbers, `++`, `--`)
- Template literals, ternaries, or arbitrary function calls
- Regex conditions — there's no way to express "matches this pattern" here
- `as` type-cast expressions anywhere in `vars`' initial values
- Multiple `return` statements in one branch, or a branch that doesn't end in `return`

Any of these produce a compile error listed under the editor, with a line number where possible —
try to keep branches simple and literal, in the style of the examples above.

## Annotated walkthrough (Example 1)

The built-in **Example 1** tab, with the meaning of each piece explained inline. (The shipped
source itself has no comments — see the top of the README for why — this is the same code with
annotations added for reference.)

```ts
// Each declared state becomes its own node in the diagram. These are the only
// state names that may be used anywhere else in the code.
type State = "s1";

// The start state. It must already be one of the names declared in `State` above.
const startState: State = "s1";

// `vars` are any variables you want to reference or build up while the machine runs.
const vars: { field: string; row: string[]; rows: string[][] } = {
  field: "",
  row: [],
  rows: [],
};

// The function that actually transitions between states. It's a switch statement with
// one case per declared state. The visualizer calls `step` once per character of your
// input, in order, feeding it the current state and getting the next state back.
function step(state: State, char: string | null): State {
  switch (state) {
    case "s1":
      // Each `if` inside a case becomes an edge out of that state. The condition
      // (`char === ...`) becomes the edge's label; the actions before `return` run
      // when that edge is taken.
      if (char === ",") {
        vars.row.push(vars.field);
        vars.field = "";
        return "s1";
      }
      if (char === "\n") {
        vars.row.push(vars.field);
        vars.field = "";
        vars.rows.push(vars.row);
        vars.row = [];
        return "s1";
      }
      if (char === null) {
        vars.row.push(vars.field);
        vars.field = "";
        vars.rows.push(vars.row);
        vars.row = [];
        return "s1";
      }
      // A bare block with no `if` works the same way, except the edge it becomes is
      // labeled "otherwise" — it matches anything not already caught above.
      vars.field += char;
      return "s1";
  }
}
```

## Full example

The two-state starter that ships in the TypeScript tab:

```ts
// Two states that just take turns "reading" each character.
type State = "stateA" | "stateB";

const labels: Record<State, string> = {
  stateA: "State A",
  stateB: "State B",
};

const startState: State = "stateA";

const vars = {
  log: "",
};

function step(state: State, char: string | null): State {
  switch (state) {
    case "stateA":
      if (char === null) {
        return "stateA";
      }
      vars.log += char;
      return "stateB";

    case "stateB":
      if (char === null) {
        return "stateB";
      }
      vars.log += char;
      return "stateA";
  }
}
```

A closer-to-real example — a CSV field parser:

```ts
type State = "startOfField" | "insideField";

const labels: Record<State, string> = {
  startOfField: "Start of Field",
  insideField: "Inside Field",
};

const startState: State = "startOfField";

const vars: { field: string; record: string[]; records: string[][] } = {
  field: "",
  record: [],
  records: [],
};

function step(state: State, char: string | null): State {
  switch (state) {
    case "startOfField":
      if (char === ",") {
        vars.record.push(vars.field);
        vars.field = "";
        return "startOfField";
      }
      if (char === null) {
        vars.record.push(vars.field);
        vars.field = "";
        vars.records.push(vars.record);
        vars.record = [];
        return "startOfField";
      }
      vars.field += char;
      return "insideField";

    case "insideField":
      if (char === ",") {
        vars.record.push(vars.field);
        vars.field = "";
        return "startOfField";
      }
      if (char === null) {
        vars.record.push(vars.field);
        vars.field = "";
        vars.records.push(vars.record);
        vars.record = [];
        return "startOfField";
      }
      vars.field += char;
      return "insideField";
  }
}
```
