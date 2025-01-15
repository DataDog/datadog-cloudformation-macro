import { Resources } from "../common/types";
import { StateMachine, DefinitionString } from "./types";
import log from "loglevel";

// Lambda invocation step's Payload field
export type LambdaStepPayload = {
  "Execution.$"?: any;
  Execution?: any;
  "State.$"?: any;
  State?: any;
  "StateMachine.$"?: any;
  StateMachine?: any;
};

export interface StateMachineDefinition {
  States: { [key: string]: StateMachineState };
}

// A state in the Step Function definition
export interface StateMachineState {
  Resource?: string;
  Parameters?: {
    FunctionName?: string;
    // Payload field for Lambda invocation steps
    Payload?: string | LambdaStepPayload;
    "Payload.$"?: string;
  };
  Next?: string;
  End?: boolean;
}

// Format of definitionString field in state machine properties
enum StateMachineDefinitionFormat {
  // a plain string
  STRING = "STRING",
  // {"Fn::Sub": string}
  FN_SUB_WITH_STRING = "FN_SUB_WITH_STRING",
}

/**
 * Modify the defintion of Lambda and Step Function invocation steps to allow merging the current Step Function's
 * traces with its downstream Lambda or Step Functions' traces.
 *
 * In case of unsupported cases, this function will log a warning instead of throwing an error
 * because merging traces is not a critical step of instrumenting Step Functions.
 */
export function mergeTracesWithDownstream(resources: Resources, stateMachine: StateMachine): boolean {
  log.debug(`Setting up trace merging for State Machine ${stateMachine.resourceKey}`);

  let definitionString = stateMachine.properties.DefinitionString;
  if (definitionString === undefined) {
    log.warn(
      `State machine ${stateMachine.resourceKey} does not have a definition string. ` +
        getUnsupportedCaseErrorMessage("Lambda or Step Function"),
    );
    return false;
  }

  // Step 1: Parse definition object from definition string
  let definitionObj: StateMachineDefinition;
  let definitionFormat: StateMachineDefinitionFormat;

  try {
    [definitionObj, definitionFormat] = parseDefinitionObjectFromDefinitionString(definitionString);
  } catch (error) {
    log.warn(error + " " + getUnsupportedCaseErrorMessage("Lambda or Step Function"));
    return false;
  }

  // Step 2: Mutate the definition object
  const states = definitionObj.States;
  for (const [stepName, step] of Object.entries(states)) {
    // Only inject context into Lambda invocation steps
    if (isLambdaInvocationStep(step?.Resource)) {
      try {
        updateDefinitionForLambdaInvocationStep(stepName, step);
      } catch (error) {
        log.warn(error + " " + getUnsupportedCaseErrorMessage("Lambda"));
        return false;
      }
    }
  }

  // Step 3: Convert definition object back into definition string
  definitionString = dumpDefinitionObjectAsDefinitionString(definitionObj, definitionFormat);

  // Step 4: Write back the definition string to the state machine
  stateMachine.properties.DefinitionString = definitionString;
  return true;
}

function parseDefinitionObjectFromDefinitionString(
  definitionString: DefinitionString,
): [StateMachineDefinition, StateMachineDefinitionFormat] {
  let definitionFormat: StateMachineDefinitionFormat;
  let definitionObj;

  if (typeof definitionString === "string") {
    // Case 1: definitionString is a string
    definitionFormat = StateMachineDefinitionFormat.STRING;
    definitionObj = JSON.parse(definitionString);
  } else if (typeof definitionString === "object" && "Fn::Sub" in definitionString) {
    // Case 2: definitionString is {"Fn::Sub": string}
    definitionFormat = StateMachineDefinitionFormat.FN_SUB_WITH_STRING;
    definitionObj = JSON.parse(definitionString["Fn::Sub"]);
  } else {
    throw new Error("Unsupported definition string format.");
  }

  return [definitionObj, definitionFormat];
}

function dumpDefinitionObjectAsDefinitionString(
  definitionObj: StateMachineDefinition,
  definitionFormat: StateMachineDefinitionFormat,
): DefinitionString {
  switch (definitionFormat) {
    case StateMachineDefinitionFormat.STRING:
      return JSON.stringify(definitionObj);
    case StateMachineDefinitionFormat.FN_SUB_WITH_STRING:
      return { "Fn::Sub": JSON.stringify(definitionObj) };
  }
}

function isLambdaInvocationStep(resource: string | undefined): boolean {
  return (
    resource !== undefined &&
    (resource?.startsWith("arn:aws:states:::lambda:invoke") || resource?.startsWith("arn:aws:lambda"))
  );
}

function updateDefinitionForLambdaInvocationStep(stepName: string, state: StateMachineState): void {
  // TODO: Replace this dummy implementation with the actual implementation
  state.Parameters = { FunctionName: "MyLambdaFunction" };
}

function getUnsupportedCaseErrorMessage(resourceType: string): string {
  return `Step Functions Context Object injection skipped. Your Step Function's trace will \
not be merged with downstream ${resourceType}'s traces. To manually merge these traces, check out \
https://docs.datadoghq.com/serverless/step_functions/troubleshooting/. You may also open a feature request in \
https://github.com/DataDog/datadog-cloudformation-macro. In the feature request, please include the \
definition of your Lambda step or Step Function invocation step.\n`;
}
