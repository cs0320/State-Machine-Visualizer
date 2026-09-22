import { describe, it, expect } from "vitest";
import { evaluateExpr, matchesCondition } from "./expression";
import type { JsonValue, MachineExpr } from "../types/stateMachine";

const NO_VARS: Record<string, JsonValue> = {};

describe("evaluateExpr", () => {
  it("resolves char, var, and literal", () => {
    expect(evaluateExpr({ kind: "char" }, "x", NO_VARS)).toBe("x");
    expect(evaluateExpr({ kind: "char" }, null, NO_VARS)).toBe("");
    expect(evaluateExpr({ kind: "var", name: "count" }, "x", { count: 5 })).toBe(5);
    expect(evaluateExpr({ kind: "var", name: "missing" }, "x", NO_VARS)).toBeNull();
    expect(evaluateExpr({ kind: "literal", value: "hi" }, "x", NO_VARS)).toBe("hi");
  });

  describe("call", () => {
    it("parseInt parses a digit character to a number", () => {
      const expr: MachineExpr = { kind: "call", name: "parseInt", args: [{ kind: "char" }] };
      expect(evaluateExpr(expr, "7", NO_VARS)).toBe(7);
    });

    it("parseInt on a non-digit character is NaN", () => {
      const expr: MachineExpr = { kind: "call", name: "parseInt", args: [{ kind: "char" }] };
      expect(evaluateExpr(expr, "x", NO_VARS)).toBeNaN();
    });

    it("isNaN detects the parseInt(char) failure case", () => {
      const expr: MachineExpr = { kind: "call", name: "isNaN", args: [{ kind: "call", name: "parseInt", args: [{ kind: "char" }] }] };
      expect(evaluateExpr(expr, "x", NO_VARS)).toBe(true);
      expect(evaluateExpr(expr, "5", NO_VARS)).toBe(false);
    });
  });

  it("unary ! negates truthiness", () => {
    const expr: MachineExpr = { kind: "unary", op: "!", operand: { kind: "literal", value: false } };
    expect(evaluateExpr(expr, "x", NO_VARS)).toBe(true);
  });

  describe("binary arithmetic", () => {
    // Cast is fine here: this is a test file, and typing `op` as the full BinaryOp literal union
    // (not exported from tsCompiler.ts) isn't worth duplicating just for a test helper.
    const bin = (op: string, left: MachineExpr, right: MachineExpr): MachineExpr => ({ kind: "binary", op, left, right }) as MachineExpr;

    it("+ adds two numbers", () => {
      expect(evaluateExpr(bin("+", { kind: "literal", value: 2 }, { kind: "literal", value: 3 }), "x", NO_VARS)).toBe(5);
    });

    it("+ string-concatenates when either side is a string (add9's `vars.sum + number` reliance)", () => {
      const expr = bin("+", { kind: "var", name: "sum" }, { kind: "literal", value: 9 });
      expect(evaluateExpr(expr, "x", { sum: "12" })).toBe("129");
    });

    it("- * / coerce to numbers", () => {
      expect(evaluateExpr(bin("-", { kind: "literal", value: 10 }, { kind: "literal", value: 3 }), "x", NO_VARS)).toBe(7);
      expect(evaluateExpr(bin("*", { kind: "literal", value: 4 }, { kind: "literal", value: 5 }), "x", NO_VARS)).toBe(20);
      expect(evaluateExpr(bin("/", { kind: "literal", value: 10 }, { kind: "literal", value: 4 }), "x", NO_VARS)).toBe(2.5);
    });

    it("=== and !== use strict equality", () => {
      expect(evaluateExpr(bin("===", { kind: "literal", value: 5 }, { kind: "literal", value: 5 }), "x", NO_VARS)).toBe(true);
      expect(evaluateExpr(bin("===", { kind: "literal", value: "5" }, { kind: "literal", value: 5 }), "x", NO_VARS)).toBe(false);
      expect(evaluateExpr(bin("!==", { kind: "literal", value: 5 }, { kind: "literal", value: 6 }), "x", NO_VARS)).toBe(true);
    });

    it("< <= > >= compare numerically once operands aren't both strings", () => {
      expect(evaluateExpr(bin(">=", { kind: "literal", value: 9 }, { kind: "literal", value: 10 }), "x", NO_VARS)).toBe(false);
      expect(evaluateExpr(bin(">=", { kind: "literal", value: 10 }, { kind: "literal", value: 10 }), "x", NO_VARS)).toBe(true);
      expect(evaluateExpr(bin("<=", { kind: "literal", value: 3 }, { kind: "literal", value: 3 }), "x", NO_VARS)).toBe(true);
      expect(evaluateExpr(bin(">", { kind: "literal", value: 4 }, { kind: "literal", value: 3 }), "x", NO_VARS)).toBe(true);
    });

    it("< <= > >= compare lexicographically when both operands are strings", () => {
      expect(evaluateExpr(bin("<", { kind: "literal", value: "apple" }, { kind: "literal", value: "banana" }), "x", NO_VARS)).toBe(true);
    });

    it("&& and || short-circuit and return the deciding operand's value, matching JS", () => {
      const zero: MachineExpr = { kind: "literal", value: 0 };
      const five: MachineExpr = { kind: "literal", value: 5 };
      expect(evaluateExpr(bin("&&", zero, five), "x", NO_VARS)).toBe(0);
      expect(evaluateExpr(bin("||", zero, five), "x", NO_VARS)).toBe(5);
      expect(evaluateExpr(bin("&&", five, zero), "x", NO_VARS)).toBe(0);
    });
  });

  it("the corrected add9 guard: parseInt(char)+9-10 for a carry, chained arithmetic", () => {
    // vars.sum = vars.sum + (parseInt(char) + 9 - 10)
    const expr: MachineExpr = {
      kind: "binary",
      op: "+",
      left: { kind: "var", name: "sum" },
      right: {
        kind: "binary",
        op: "-",
        left: { kind: "binary", op: "+", left: { kind: "call", name: "parseInt", args: [{ kind: "char" }] }, right: { kind: "literal", value: 9 } },
        right: { kind: "literal", value: 10 },
      },
    };
    expect(evaluateExpr(expr, "8", { sum: "1" })).toBe("17"); // 8 + 9 - 10 = 7, "1" + 7 -> "17"
  });
});

describe("matchesCondition (expr kind)", () => {
  const expr: MachineExpr = {
    kind: "binary",
    op: ">=",
    left: { kind: "binary", op: "+", left: { kind: "call", name: "parseInt", args: [{ kind: "char" }] }, right: { kind: "literal", value: 9 } },
    right: { kind: "literal", value: 10 },
  };

  it("evaluates the expression against the current char and coerces to boolean", () => {
    expect(matchesCondition({ type: "expr", expr }, "1", NO_VARS)).toBe(true); // 1+9=10 >= 10
    expect(matchesCondition({ type: "expr", expr }, "0", NO_VARS)).toBe(false); // 0+9=9 >= 10
  });

  it("never matches the end-of-input event, like other character conditions", () => {
    expect(matchesCondition({ type: "expr", expr }, null, NO_VARS)).toBe(false);
  });

  it("can read variables", () => {
    const countCheck: MachineExpr = { kind: "binary", op: ">", left: { kind: "var", name: "count" }, right: { kind: "literal", value: 3 } };
    expect(matchesCondition({ type: "expr", expr: countCheck }, "x", { count: 4 })).toBe(true);
    expect(matchesCondition({ type: "expr", expr: countCheck }, "x", { count: 2 })).toBe(false);
  });
});
