export const example1 = {
  tabName: "Example 1",
  source: `// Each declared state becomes its own node in the diagram. These are the only
// state names that may be used anywhere else in the code.
type State = "s1";

// Must define a start state with type State. The start state must be a state that
// has already been declared.
const startState: State = "s1";

// Vars are any variables you want to reference or append to during the iteration of
// the state machine.
const vars: { field: string; row: string[]; rows: string[][] } = {
  field: "",
  row: [],
  rows: [],
};

// This is your main function that actually transitions through the defined states.
// It uses a switch statement and each case should correspond to every defined state.
// The visualizer runs a step for you so once you give it an input it will run the
// step function on each character in the given string.
function step(state: State, char: string | null): State {
  switch (state) {
    case "s1":
      // Under each case in the switch statement you use if/else statements to parse
      // the input. The conditionals in the if statements become the edges of the
      // state machine to other states.
      if (char === ",") {
        vars.row.push(vars.field);
        vars.field = "";
        return "s1";
      }
      if (char === "\\n") {
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
      // The edges of else statements or default cases that return to the same state are 
      // denoted as otherwise 
      vars.field += char;
      return "s1";
  }
}
`,
};
