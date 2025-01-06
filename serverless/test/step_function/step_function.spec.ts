import { findStateMachines } from "../../src/step_function/step_function";

describe("findStateMachines", () => {
  it("returns an empty array when no state machines are present", () => {
    const resources = {
      SomeOtherResource: {
        Type: "AWS::Lambda::Function",
        Properties: {},
      },
    };

    const result = findStateMachines(resources);
    expect(result).toEqual([]);
  });

  it("returns an array with state machines when they are present", () => {
    const resources = {
      FirstStateMachine: {
        Type: "AWS::StepFunctions::StateMachine",
        Properties: {
          DefinitionUri: "state_machine/first.asl.json",
        },
      },
      SecondStateMachine: {
        Type: "AWS::StepFunctions::StateMachine",
        Properties: {
          DefinitionUri: "state_machine/second.asl.json",
        },
      },
      SomeOtherResource: {
        Type: "AWS::Lambda::Function",
        Properties: {},
      },
    };

    const result = findStateMachines(resources);
    expect(result).toHaveLength(2);
    expect(result[0].resourceKey).toBe("FirstStateMachine");
    expect(result[1].resourceKey).toBe("SecondStateMachine");
  });
});
