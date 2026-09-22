import { describe, it, expect } from "vitest";
import { compileTypeScript } from "./tsCompiler";
import { typeCheckTypeScript } from "./tsTypeCheck";

// Not a correctness test — a resilience test. Neither function should ever throw, no matter how
// malformed the input is: they should report it as an error (CompileError[] / TypeCheckError[]),
// since one uncaught exception here (with no ErrorBoundary anywhere in the app) would white-screen
// a student's whole session on a single bad paste.
const adversarialInputs: string[] = [
  "",
  "   ",
  "type State = ;",
  "type State = string;",
  "type State = 5;",
  'type State = "a" | 5;',
  "const startState = null;",
  "function step() {}",
  'type State = "a"; const startState: State = "a"; const vars = {}; function step(state, char) { switch(state) {} }',
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": if (char === "a" || char) return "a"; return "a"; } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": if (foo === "a") return "a"; return "a"; } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": vars.x.y.z = 1; return "a"; } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": vars[char] = 1; return "a"; } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": return foo(); } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": for (;;) {} return "a"; } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; async function step(state: State, char: string | null): Promise<State> { switch (state) { case "a": return "a"; } }',
  'type State = "a"; const vars = {}; const startState: State = "a"; const step = (state: State, char: string | null): State => { switch (state) { case "a": return "a"; } };',
  'type State = "a" | "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": return "a"; } }',
  'type State = "a"; const startState: State = "a";',
  'type State = "a"; const vars = { x: undefined }; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": return "a"; } }',
  'type State = "a"; const vars = { x: () => 1 }; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": return "a"; } }',
  "class Foo {}",
  "import x from 'y';",
  "@decorator class Foo {}",
  "@".repeat(3000),
  "{".repeat(3000),
  "function step(state, char) { switch (state) { case undefined: return 1; } }",
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": return `template${1}`; } }',
  "(".repeat(3000) + ")".repeat(3000),
  "if (true) {".repeat(3000),
  "[".repeat(3000),
  "type State = \"a\";\n".repeat(3000) + 'const startState: State = "a";',
  // Syntactically valid (unlike the deeply-nested-but-incomplete cases above), so this is the one
  // that actually exercises parseExpr's own recursion in tsCompiler.ts rather than failing at the
  // initial Babel parse — MAX_EXPR_DEPTH is what's expected to catch it instead of the call stack.
  'type State = "a"; const vars = {}; const startState: State = "a"; function step(state: State, char: string | null): State { switch (state) { case "a": if (' +
    "1+".repeat(3000) +
    '1 === 1) return "a"; return "a"; } }',
];

describe("compiler and type-checker resilience", () => {
  it.each(adversarialInputs.map((source, i) => [i, source] as const))("input #%i never throws", (_i, source) => {
    expect(() => compileTypeScript(source)).not.toThrow();
    expect(() => typeCheckTypeScript(source)).not.toThrow();
  });
});
