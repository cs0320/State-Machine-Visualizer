import { describe, it, expect } from "vitest";
import { compileTypeScript } from "./tsCompiler";
import { simulate } from "./simulate";
import { example1 } from "../examples/example1";
import { example2 } from "../examples/example2";
import { example3 } from "../examples/example3";

const MINIMAL_VALID = `
type State = "a" | "b";
const startState: State = "a";
const vars: { field: string } = { field: "" };
function step(state: State, char: string | null): State {
  switch (state) {
    case "a":
      if (char === null) {
        return "a";
      }
      vars.field += char;
      return "b";
    case "b":
      return "a";
  }
}
`;

describe("compileTypeScript", () => {
  it("compiles the three shipped example sources without error", () => {
    for (const ex of [example1, example2, example3]) {
      const result = compileTypeScript(ex.source);
      expect(result.ok, result.ok ? "" : JSON.stringify((result as { errors: unknown }).errors)).toBe(true);
    }
  });

  it("reproduces the naive/toggle/escape-aware CSV progression on the same input", () => {
    const input = '"Smith, John","said ""hi"""';

    const r1 = compileTypeScript(example1.source);
    const r2 = compileTypeScript(example2.source);
    const r3 = compileTypeScript(example3.source);
    if (!r1.ok || !r2.ok || !r3.ok) throw new Error("expected all three examples to compile");

    expect(simulate(r1.machine, input).finalVariables.rows).toEqual([["\"Smith", " John\"", '"said ""hi"""']]);
    expect(simulate(r2.machine, input).finalVariables.rows).toEqual([["Smith, John", "said hi"]]);
    expect(simulate(r3.machine, input).finalVariables.rows).toEqual([["Smith, John", 'said "hi"']]);
  });

  it("compiles a minimal well-formed machine", () => {
    const result = compileTypeScript(MINIMAL_VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.machine.states.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.machine.startState).toBe("a");
  });

  it("rejects a source with no `type State` declaration", () => {
    const result = compileTypeScript(`const startState = "a";`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/type State/);
  });

  it("rejects a source with no `vars` declaration", () => {
    const source = MINIMAL_VALID.replace(/const vars.*= \{ field: "" \};/, "");
    const result = compileTypeScript(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /vars/.test(e.message))).toBe(true);
  });

  it("rejects a case whose return value is not a declared state", () => {
    const source = MINIMAL_VALID.replace('return "b";', 'return "c";');
    const result = compileTypeScript(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /not a declared state/.test(e.message))).toBe(true);
  });

  it("requires every declared state to have a case in the switch", () => {
    const source = `
type State = "a" | "b";
const startState: State = "a";
const vars: {} = {};
function step(state: State, char: string | null): State {
  switch (state) {
    case "a":
      return "a";
  }
}
`;
    const result = compileTypeScript(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /has no case/.test(e.message))).toBe(true);
  });

  it("recognizes `charIn` from a chain of `char === \"x\" || ...`", () => {
    const source = `
type State = "a";
const startState: State = "a";
const vars: { field: string } = { field: "" };
function step(state: State, char: string | null): State {
  switch (state) {
    case "a":
      if (char === "x" || char === "y" || char === "z") {
        vars.field += char;
        return "a";
      }
      return "a";
  }
}
`;
    const result = compileTypeScript(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rule = result.machine.transitions.find((t) => t.condition.type === "charIn");
    expect(rule?.condition).toEqual({ type: "charIn", values: ["x", "y", "z"] });
  });

  it("marks states listed in `errorStates` as isError, and gives every declared state a source line range", () => {
    const source = `
type State = "reading" | "error";
const errorStates: State[] = ["error"];
const startState: State = "reading";
const vars: { text: string } = { text: "" };
function step(state: State, char: string | null): State {
  switch (state) {
    case "reading":
      if (char === "!") {
        return "error";
      }
      return "reading";
    case "error":
      return "error";
  }
}
`;
    const result = compileTypeScript(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.machine.states.find((s) => s.id === "error")?.isError).toBe(true);
    expect(result.machine.states.find((s) => s.id === "reading")?.isError).toBeFalsy();
    expect(result.sourceMap.states.reading).toBeDefined();
    expect(result.sourceMap.states.error).toBeDefined();
  });
});

// A scaled-down "add 9 to one digit" machine exercising parseInt/isNaN/arithmetic/comparison
// together — the same shapes src/examples/add9.ts needs, corrected to use
// `isNaN(parseInt(char))` rather than comparing to `undefined` (global isNaN, not Number.isNaN,
// since Number.isNaN is ES2015+ and tsTypeCheck.ts's real-tsc pass only loads lib.es5.d.ts).
const ADD_ONE_DIGIT = `
type State = "start" | "done" | "error";
const startState: State = "start";
const vars: { sum: string } = { sum: "" };
function step(state: State, char: string | null): State {
  switch (state) {
    case "start":
      if (char === null) return "error";
      if (isNaN(parseInt(char))) return "error";
      if (parseInt(char) + 9 >= 10) {
        vars.sum = vars.sum + (parseInt(char) + 9 - 10);
        return "done";
      }
      vars.sum = vars.sum + (parseInt(char) + 9);
      return "done";
    case "done":
      return "done";
    case "error":
      return "error";
  }
}
`;

describe("compileTypeScript — MachineExpr conditions and action values", () => {
  it("compiles `expr` conditions with the pretty-printed MachineExpr tree and label", () => {
    const result = compileTypeScript(ADD_ONE_DIGIT);
    expect(result.ok, result.ok ? "" : JSON.stringify((result as { errors: unknown }).errors)).toBe(true);
    if (!result.ok) return;

    const carryCheck = result.machine.transitions.find((t) => t.label?.includes(">="));
    expect(carryCheck?.condition).toEqual({
      type: "expr",
      expr: {
        kind: "binary",
        op: ">=",
        left: {
          kind: "binary",
          op: "+",
          left: { kind: "call", name: "parseInt", args: [{ kind: "char" }] },
          right: { kind: "literal", value: 9 },
        },
        right: { kind: "literal", value: 10 },
      },
    });
    expect(carryCheck?.label).toBe("(parseInt(char) + 9) >= 10");

    const nanCheck = result.machine.transitions.find((t) => t.label?.includes("isNaN"));
    expect(nanCheck?.condition).toEqual({
      type: "expr",
      expr: { kind: "call", name: "isNaN", args: [{ kind: "call", name: "parseInt", args: [{ kind: "char" }] }] },
    });
  });

  it("compiles an arithmetic action value: vars.sum = vars.sum + (parseInt(char) + 9 - 10)", () => {
    const result = compileTypeScript(ADD_ONE_DIGIT);
    if (!result.ok) throw new Error("expected ADD_ONE_DIGIT to compile");

    const carryAction = result.machine.transitions.find((t) => t.label?.includes(">="))?.actions[0];
    expect(carryAction).toEqual({
      type: "set",
      target: "sum",
      value: {
        kind: "binary",
        op: "+",
        left: { kind: "var", name: "sum" },
        right: {
          kind: "binary",
          op: "-",
          left: {
            kind: "binary",
            op: "+",
            left: { kind: "call", name: "parseInt", args: [{ kind: "char" }] },
            right: { kind: "literal", value: 9 },
          },
          right: { kind: "literal", value: 10 },
        },
      },
    });
  });

  it("runs end-to-end: no carry, carry, and the isNaN error guard", () => {
    const result = compileTypeScript(ADD_ONE_DIGIT);
    if (!result.ok) throw new Error("expected ADD_ONE_DIGIT to compile");

    expect(simulate(result.machine, "0").finalVariables.sum).toBe("9"); // 0 + 9 = 9, no carry
    expect(simulate(result.machine, "8").finalVariables.sum).toBe("7"); // 8 + 9 = 17 -> carry, sum "7"
    expect(simulate(result.machine, "x").finalState).toBe("error"); // isNaN(parseInt("x")) guard
  });

  it("rejects parseInt/isNaN calls with the wrong number of arguments", () => {
    const zeroArgs = ADD_ONE_DIGIT.replace("isNaN(parseInt(char))", "isNaN(parseInt())");
    const r1 = compileTypeScript(zeroArgs);
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.errors.some((e) => /must take exactly one argument/.test(e.message))).toBe(true);

    const twoArgs = ADD_ONE_DIGIT.replace("parseInt(char)", "parseInt(char, 10)");
    const r2 = compileTypeScript(twoArgs);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.errors.some((e) => /must take exactly one argument/.test(e.message))).toBe(true);
  });

  it("rejects an unsupported operator (%) rather than silently dropping the branch", () => {
    const source = ADD_ONE_DIGIT.replace('if (parseInt(char) + 9 >= 10) {', 'if (parseInt(char) % 2 === 0) {');
    const result = compileTypeScript(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a pathologically deep expression with a CompileError instead of overflowing the stack", () => {
    const deep = "1+".repeat(60) + "1"; // nests ~60 binary "+" nodes, past MAX_EXPR_DEPTH
    const source = ADD_ONE_DIGIT.replace("parseInt(char) + 9 >= 10", deep + " >= 10");
    expect(() => compileTypeScript(source)).not.toThrow();
    const result = compileTypeScript(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /nested too deeply/.test(e.message))).toBe(true);
  });
});
