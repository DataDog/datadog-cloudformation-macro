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

    it('succeeds when definitionString is {"Fn::Sub": string}', () => {
      stateMachine.properties.DefinitionString = {
        "Fn::Sub": JSON.stringify(stateMachineDefinition),
      };
      const isTraceMergingSetUp = mergeTracesWithDownstream(resources, stateMachine);
      expect(isTraceMergingSetUp).toBe(true);

      const updatedDefinition = JSON.parse(stateMachine.properties.DefinitionString!["Fn::Sub"]);
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
