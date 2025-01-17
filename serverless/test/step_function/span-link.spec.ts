import {
  mergeTracesWithDownstream,
  StateMachineState,
  StateMachineDefinition,
  updateDefinitionForLambdaInvocationStep,
  updateDefinitionForStepFunctionInvocationStep,
} from "../../src/step_function/span-link";
import { Resources } from "common/types";
import { StateMachine } from "../../src/step_function/types";

describe("Step Function Span Link", () => {
  describe("mergeTracesWithDownstream", () => {
    let resources: Resources;
    let stateMachineDefinition: StateMachineDefinition;
    let stateMachine: StateMachine;
    const stateMachineKey = "MyStateMachine";

    beforeEach(() => {
      resources = {};
      stateMachineDefinition = {
        States: {
          HelloFunction: {
            Type: "Task",
            Resource: "arn:aws:states:::lambda:invoke",
            Parameters: {
              FunctionName: "MyLambdaFunction",
            },
            End: true,
          } as StateMachineState,
        },
      };
      stateMachine = {
        resourceKey: stateMachineKey,
        properties: {},
      };
    });

    it("Case 1: succeeds when definitionString is a string", () => {
      stateMachine.properties.DefinitionString = JSON.stringify(stateMachineDefinition);
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(true);

      const updatedDefinition = JSON.parse(stateMachine.properties.DefinitionString);
      expect(updatedDefinition.States["HelloFunction"].Parameters["Payload.$"]).toEqual(
        "$$['Execution', 'State', 'StateMachine']",
      );
    });

    it('Case 2: succeeds when definitionString is {"Fn::Sub": string}', () => {
      stateMachine.properties.DefinitionString = {
        "Fn::Sub": JSON.stringify(stateMachineDefinition),
      };
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(true);

      const updatedDefinitionString = stateMachine.properties.DefinitionString as { "Fn::Sub": string };
      const updatedDefinition = JSON.parse(updatedDefinitionString["Fn::Sub"]);
      expect(updatedDefinition.States["HelloFunction"].Parameters["Payload.$"]).toEqual(
        "$$['Execution', 'State', 'StateMachine']",
      );
    });

    it('Case 3: succeeds when definitionString is {"Fn::Sub": (string | object)[]}', () => {
      stateMachine.properties.DefinitionString = {
        "Fn::Sub": [JSON.stringify(stateMachineDefinition), {}],
      };
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(true);

      const updatedDefinitionString = stateMachine.properties.DefinitionString as { "Fn::Sub": (string | object)[] };
      const updatedDefinition = JSON.parse(updatedDefinitionString["Fn::Sub"][0] as string);
      expect(updatedDefinition.States["HelloFunction"].Parameters["Payload.$"]).toEqual(
        "$$['Execution', 'State', 'StateMachine']",
      );
    });

    it("fails when state machine's definition is not found", () => {
      // stateMachine has no DefinitionString field
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(false);
    });

    it("fails when state machine's DefinitionString is invalid", () => {
      stateMachine.properties.DefinitionString = {
        "Fn::Sub": "{",
      };
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(false);
    });
  });

  describe("updateDefinitionForLambdaInvocationStep", () => {
    const stepName = "LambdaInvokeStep";
    let lambdaState: StateMachineState;

    beforeEach(() => {
      lambdaState = {
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: {
          FunctionName: "arn:aws:lambda:us-east-1:123456789012:function:my-function",
        },
        End: true,
      };
    });

    it("Case 1: Lambda step has no Payload or Payload.$", () => {
      updateDefinitionForLambdaInvocationStep(stepName, lambdaState);
      expect(lambdaState.Parameters!["Payload.$"]).toEqual("$$['Execution', 'State', 'StateMachine']");
    });

    it("Case 2.1: Payload object has Execution, State or StateMachine field", () => {
      lambdaState.Parameters!.Payload = {
        Execution: "Execution Field",
      };

      expect(() => {
        updateDefinitionForLambdaInvocationStep(stepName, lambdaState);
      }).toThrow("Parameters.Payload has Execution, State or StateMachine field.");
    });

    it("Case 2.2: Payload object has no Execution.$, State.$ or StateMachine.$ field", () => {
      lambdaState.Parameters!.Payload = {};
      updateDefinitionForLambdaInvocationStep(stepName, lambdaState);

      expect(lambdaState.Parameters!.Payload).toStrictEqual({
        "Execution.$": "$$.Execution",
        "State.$": "$$.State",
        "StateMachine.$": "$$.StateMachine",
      });
    });

    it("Case 3: Payload is not an object", () => {
      lambdaState.Parameters!.Payload = "not an object";

      expect(() => {
        updateDefinitionForLambdaInvocationStep(stepName, lambdaState);
      }).toThrow("Parameters.Payload field is not a JSON object.");
    });

    it("Case 4.1: Lambda step has default Payload.$ field", () => {
      lambdaState.Parameters!["Payload.$"] = "$";

      updateDefinitionForLambdaInvocationStep(stepName, lambdaState);
      expect(lambdaState.Parameters!["Payload.$"]).toEqual("States.JsonMerge($$, $, false)");
    });

    it("Case 4.2: Lambda step has custom Payload.$ field", () => {
      lambdaState.Parameters!["Payload.$"] = "$$['execution']";

      expect(() => updateDefinitionForLambdaInvocationStep(stepName, lambdaState)).toThrow(
        "Parameters.Payload has a custom Payload.$ field.",
      );
    });
  });

  describe("updateDefinitionForStepFunctionInvocationStep", () => {
    const stepName = "StepFunctionInvokeStep";
    let stateMachineState: StateMachineState;

    beforeEach(() => {
      stateMachineState = {
        Resource: "arn:aws:states:::states:startExecution",
        Parameters: {},
        End: true,
      };
    });

    it("Case 0.1: Parameters field is not an object", () => {
      stateMachineState.Parameters = "not an object" as any;
      expect(() => {
        updateDefinitionForStepFunctionInvocationStep(stepName, stateMachineState);
      }).toThrow("Parameters field is not an object.");
    });

    it("Case 0.2: Parameters field has no Input field", () => {
      updateDefinitionForStepFunctionInvocationStep(stepName, stateMachineState);
      expect(stateMachineState.Parameters!.Input).toStrictEqual({
        "CONTEXT.$": "States.JsonMerge($$, $, false)",
      });
    });

    it("Case 0.3: Parameters.Input is not an object", () => {
      stateMachineState.Parameters!.Input = "not an object";
      expect(() => {
        updateDefinitionForStepFunctionInvocationStep(stepName, stateMachineState);
      }).toThrow("Parameters.Input field is not an object.");
    });

    it("Case 1: No CONTEXT or CONTEXT.$ field", () => {
      stateMachineState.Parameters!.Input = {};
      updateDefinitionForStepFunctionInvocationStep(stepName, stateMachineState);
      expect(stateMachineState.Parameters!.Input).toEqual({
        "CONTEXT.$": "$$['Execution', 'State', 'StateMachine']",
      });
    });

    it("Case 2: Has CONTEXT field", () => {
      stateMachineState.Parameters!.Input = {
        CONTEXT: "some context",
      };
      expect(() => {
        updateDefinitionForStepFunctionInvocationStep(stepName, stateMachineState);
      }).toThrow("Parameters.Input has a custom CONTEXT field.");
    });

    it("Case 2: Has CONTEXT.$ field", () => {
      stateMachineState.Parameters!.Input = {
        "CONTEXT.$": "some context",
      };
      expect(() => {
        updateDefinitionForStepFunctionInvocationStep(stepName, stateMachineState);
      }).toThrow("Parameters.Input has a custom CONTEXT field.");
    });
  });
});
