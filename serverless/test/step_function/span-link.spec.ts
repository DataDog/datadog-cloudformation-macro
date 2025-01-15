import {
  mergeTracesWithDownstream,
  StateMachineState,
  StateMachineDefinition,
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
      expect(updatedDefinition.States["HelloFunction"].Parameters).toStrictEqual({ FunctionName: "MyLambdaFunction" });
    });

    it('Case 2: succeeds when definitionString is {"Fn::Sub": string}', () => {
      stateMachine.properties.DefinitionString = {
        "Fn::Sub": JSON.stringify(stateMachineDefinition),
      };
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(true);

      const updatedDefinitionString = stateMachine.properties.DefinitionString as { "Fn::Sub": string };
      const updatedDefinition = JSON.parse(updatedDefinitionString["Fn::Sub"]);
      expect(updatedDefinition.States["HelloFunction"].Parameters).toStrictEqual({ FunctionName: "MyLambdaFunction" });
    });

    it('Case 3: succeeds when definitionString is {"Fn::Sub": (string | object)[]}', () => {
      stateMachine.properties.DefinitionString = {
        "Fn::Sub": [JSON.stringify(stateMachineDefinition), {}],
      };
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(true);

      const updatedDefinitionString = stateMachine.properties.DefinitionString as { "Fn::Sub": (string | object)[] };
      const updatedDefinition = JSON.parse(updatedDefinitionString["Fn::Sub"][0] as string);
      expect(updatedDefinition.States["HelloFunction"].Parameters).toStrictEqual({ FunctionName: "MyLambdaFunction" });
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
});
