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
// For more about Fn::Sub, see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-sub.html
enum StateMachineDefinitionFormat {
  // a plain string
  STRING = "STRING",
  // {"Fn::Sub": string}
  FN_SUB_WITH_STRING = "FN_SUB_WITH_STRING",
  // { "Fn::Sub": (string | object)[] }
  FN_SUB_WITH_ARRAY = "FN_SUB_WITH_ARRAY",
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
  definitionString = dumpDefinitionObjectAsDefinitionString(definitionObj, definitionFormat, definitionString);

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
    if (typeof definitionString["Fn::Sub"] === "string") {
      // Case 2: definitionString is {"Fn::Sub": string}
      definitionFormat = StateMachineDefinitionFormat.FN_SUB_WITH_STRING;
      definitionObj = JSON.parse(definitionString["Fn::Sub"]);
    } else {
      // Case 3: definitionString is {"Fn::Sub": (string | object)[]}
      const fnSubValue = definitionString["Fn::Sub"];
      if (typeof fnSubValue !== "object" || fnSubValue.length === 0 || typeof fnSubValue[0] !== "string") {
        throw new Error("Unsupported format of Fn::Sub in defition string.");
      }
      definitionFormat = StateMachineDefinitionFormat.FN_SUB_WITH_ARRAY;
      // index 0 should always be a string of step functions definition
      definitionObj = JSON.parse(fnSubValue[0]);
    }
  } else {
    throw new Error("Unsupported definition string format.");
  }

  return [definitionObj, definitionFormat];
}

function dumpDefinitionObjectAsDefinitionString(
  definitionObj: StateMachineDefinition,
  definitionFormat: StateMachineDefinitionFormat,
  originalDefinitionString: DefinitionString,
): DefinitionString {
  switch (definitionFormat) {
    case StateMachineDefinitionFormat.STRING:
      return JSON.stringify(definitionObj);
    case StateMachineDefinitionFormat.FN_SUB_WITH_STRING:
      return { "Fn::Sub": JSON.stringify(definitionObj) };
    case StateMachineDefinitionFormat.FN_SUB_WITH_ARRAY:
      (originalDefinitionString as { "Fn::Sub": (string | object)[] })["Fn::Sub"][0] = JSON.stringify(definitionObj);
      return originalDefinitionString;
  }
}

function isLambdaInvocationStep(resource: string | undefined): boolean {
  return (
    resource !== undefined &&
    (resource?.startsWith("arn:aws:states:::lambda:invoke") || resource?.startsWith("arn:aws:lambda"))
  );
}

/**
 * Modify the definition of a Lambda invocation step to allow merging the Step Function's traces with its downstream
 * Lambda's traces.
 * In case of failure, throw an error.
 *
 * Truth table
 * Case | Input                                                    | Will update
 * -----|----------------------------------------------------------|-------------
 *   1  | No "Payload" or "Payload.$"                              | true
 *  2.1 | "Payload" object has Execution, State or StateMachine    | false
 *  2.2 | "Payload" object has no Execution, State or StateMachine | true
 *   3  | "Payload" is not object                                  | false
 *  4.1 | Has default "Payload.$", (value is "$")                  | true
 *  4.2 | Has custom "Payload.$"                                   | false
 */
export function updateDefinitionForLambdaInvocationStep(stepName: string, state: StateMachineState): void {
  log.debug(`Setting up trace merging for Lambda Invocation step ${stepName}`);

  if (typeof state.Parameters !== "object") {
    throw new Error("Parameters field is not a JSON object.");
  }

  // Case 2 & 3: Parameters has "Payload" field
  if ("Payload" in state.Parameters) {
    const payload = state.Parameters.Payload;

    // Case 3: payload is not a JSON object
    if (typeof payload !== "object") {
      throw new Error("Parameters.Payload field is not a JSON object.");
    }

    // Case 2: payload is a JSON object

    // Case 2.1: "Payload" object has Execution, State or StateMachine field
    if (
      "Execution.$" in payload ||
      "Execution" in payload ||
      "State.$" in payload ||
      "State" in payload ||
      "StateMachine.$" in payload ||
      "StateMachine" in payload
    ) {
      throw new Error("Parameters.Payload has Execution, State or StateMachine field.");
    }

    // Case 2.2: "Payload" object has no Execution, State or StateMachine field
    payload["Execution.$"] = "$$.Execution";
    payload["State.$"] = "$$.State";
    payload["StateMachine.$"] = "$$.StateMachine";
    return;
  }

  // Case 4: Parameters has "Payload.$" field
  if ("Payload.$" in state.Parameters) {
    // Case 4.1 "Payload.$" has default value of "$"
    if (state.Parameters["Payload.$"] === "$") {
      state.Parameters["Payload.$"] = "States.JsonMerge($$, $, false)";
      return;
    }

    // Case 4.2: Parameters has custom "Payload.$" field. This should be rare, so we don't support this case for now.
    throw new Error("Parameters.Payload has a custom Payload.$ field.");
  }

  // Case 1: No "Payload" or "Payload.$"
  state.Parameters["Payload.$"] = "$$['Execution', 'State', 'StateMachine']";
}

function getUnsupportedCaseErrorMessage(resourceType: string): string {
  return `Step Functions Context Object injection skipped. Your Step Function's trace will \
not be merged with downstream ${resourceType}'s traces. To manually merge these traces, check out \
https://docs.datadoghq.com/serverless/step_functions/troubleshooting/. You may also open a feature request in \
https://github.com/DataDog/datadog-cloudformation-macro. In the feature request, please include the \
definition of your Lambda step or Step Function invocation step.\n`;
}
