import { findStateMachines, instrumentStateMachines } from "../../src/step_function/step_function";
import { InputEvent } from "../../src/common/types";
import log from "loglevel";

jest.mock("loglevel");

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

describe("instrumentStateMachines", () => {
  it("skips instrumentation when stepFunctionForwarderArn is not provided", async () => {
    (log.info as jest.Mock).mockImplementation(() => {
      /* empty */
    });

    const event: InputEvent = {
      requestId: "123",
      fragment: {
        Resources: {
          FirstStateMachine: {
            Type: "AWS::StepFunctions::StateMachine",
            Properties: {
              DefinitionUri: "state_machine/first.asl.json",
            },
          },
        },
      },
    } as any;

    const config = {
      stepFunctionForwarderArn: undefined,
    };

    const result = await instrumentStateMachines(event, config);
    expect(result).toEqual({
      requestId: "123",
      status: "success",
      fragment: event.fragment,
    });

    expect(log.info).toHaveBeenCalledWith(
      "stepFunctionForwarderArn is not provided. Step functions will not be instrumented.",
    );
  });
});
