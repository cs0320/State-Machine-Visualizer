/*
  Add 9 to a given number, represented as a base-10 string.
  Least significant digits come first in both the input and output. 
  
  If we wanted to add 2 arbitrary numbers, we'd need to support
    reading from two strings at once.
*/

export const add9 = {
  tabName: "Add 9",
  source: `
type State = "initial" | "carry_0" | "carry_1" | "error" | "done";

const startState: State = "initial";

const vars: { sum: string } = {
  sum: ""
};

function step(state: State, char: string | null): State {
  switch (state) {

    case "error": return "error"
    case "done" : return "done"

    case "initial":
      if(char === null) return "error";
      if(isNaN(parseInt(char))) return "error";
      if(parseInt(char) + 9 >= 10) {
        vars.sum = vars.sum + (parseInt(char) + 9 - 10)
        return "carry_1"
      } 
      vars.sum = vars.sum + (parseInt(char) + 9)
      return "carry_0"

    case "carry_0":
      if(char === null) {
        return "done";
      }
      if(isNaN(parseInt(char))) return "error";
      vars.sum = vars.sum + char
      return "carry_0"

    case "carry_1":
      if(char === null) {
        vars.sum = vars.sum + "1";
        return "done";
      }
      if(isNaN(parseInt(char))) return "error";
      if(parseInt(char) + 1 >= 10) {
        vars.sum = vars.sum + (parseInt(char) + 1 - 10)
        return "carry_1"
      } 
      // Note: beware, make sure to put the parens or 1 is treated as "1".
      vars.sum = vars.sum + (parseInt(char) + 1)
      return "carry_0"
  }
}`};
