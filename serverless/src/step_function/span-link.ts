import { Resources } from "../common/types";
import { StateMachine } from "./types";
import log from "loglevel";

// Step Function invocation step's Input field
export type StepFunctionStepInput = {
  "CONTEXT.$"?: string;
  CONTEXT?: string;
  [key: string]: unknown;
};

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
  States: { [key: string]: StepFunctionStep };
}

// Step Function invocation step
export interface StepFunctionStep {
  Resource?: string;
  Parameters?: {
    FunctionName?: string;
    // Payload field for Lambda invocation steps
    Payload?: string | LambdaStepPayload;
    "Payload.$"?: string;
    // Input field for Step Function invocation steps
    Input?: string | StepFunctionStepInput;
  };
  Next?: string;
  End?: boolean;
}

/**
 * Modify the defintion of Lambda and Step Function invocation steps to allow merging the current Step Function's
 * traces with its downstream Lambda or Step Functions' traces.
 *
 * In case of unsupported cases, this function will log a warning instead of throwing an error
 * because merging traces is not a critical step of instrumenting Step Functions.
 */
export function mergeTracesWithDownstream(resources: Resources, stateMachine: StateMachine): void {
  log.debug(`Setting up trace merging for State Machine ${stateMachine.resourceKey}`);

  let definitionString = stateMachine.properties.DefinitionString;
  if (definitionString === undefined) {
    log.warn(
      "State machine ${stateMachine.resourceKey} does not have a definition string. " +
        getUnsupportedCaseErrorMessage("Lambda or Step Function"),
    );
    return;
  }

  // Step 1: Parse definition object from definition string
  let definitionObj: StateMachineDefinition;
  if (typeof definitionString === "string") {
    definitionObj = JSON.parse(definitionString);
  } else {
    // If definitionString is an object, we require it to be {"Fn::Sub": (string | object)[]}, which is a common case
    try {
      definitionObj = parseDefinitionObject(definitionString);
    } catch (error) {
      log.warn(error + " " + getUnsupportedCaseErrorMessage("Lambda or Step Function"));
      return;
    }
  }

  // Step 2: Mutate the definition object
  const states = definitionObj.States;
  for (const [stepName, step] of Object.entries(states)) {
    // Only inject context into Lambda API steps and Step Function invocation steps
    if (isLambdaInvocationStep(step?.Resource)) {
      try {
        updateDefinitionForLambdaInvocationStep(stepName, step);
      } catch (error) {
        log.warn(error + " " + getUnsupportedCaseErrorMessage("Lambda"));
      }
    } else if (isStepFunctionInvocationStep(step?.Resource)) {
      try {
        updateDefinitionForStepFunctionInvocationStep(stepName, step);
      } catch (error) {
        log.warn(error + " " + getUnsupportedCaseErrorMessage("Step Function"));
      }
    }
  }

  // Step 3: Convert definition object back into definition string
  if (typeof definitionString !== "string") {
    definitionString["Fn::Sub"][0] = JSON.stringify(definitionObj); // writing back to the original JSON
  } else {
    definitionString = JSON.stringify(definitionObj);
  }

  // Step 4: Writing back the definition string to the parent state machine
  stateMachine.properties.DefinitionString = definitionString;
}

function parseDefinitionObject(definitionString: { "Fn::Sub": (string | object)[] }): StateMachineDefinition {
  if (
    !(typeof definitionString === "object" && "Fn::Sub" in definitionString && definitionString["Fn::Sub"].length > 0)
  ) {
    throw new Error("State machine ${stateMachine.resourceKey}'s definitionString's format is not supported.");
  }
  const unparsedDefinition = definitionString["Fn::Sub"] ? definitionString["Fn::Sub"][0] : ""; // index 0 should always be a string of step functions definition
  if (unparsedDefinition === "") {
    throw new Error("No definition string found in DefinitionString.");
  }
  const definitionObj: StateMachineDefinition = JSON.parse(unparsedDefinition as string);
  return definitionObj;
}

function isLambdaInvocationStep(resource: string | undefined): boolean {
  return (
    resource !== undefined &&
    (resource?.startsWith("arn:aws:states:::lambda:invoke") || resource?.startsWith("arn:aws:lambda"))
  );
}

function isStepFunctionInvocationStep(resource: string | undefined): boolean {
  if (resource === undefined) {
    return false;
  }
  return resource.startsWith("arn:aws:states:::states:startExecution");
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
 *   4  | Has "Payload.$"                                          | false
 */
function updateDefinitionForLambdaInvocationStep(stepName: string, step: StepFunctionStep): void {
  log.debug(`Setting up trace merging for Lambda Invocation step ${stepName}`);

  if (typeof step.Parameters !== "object") {
    throw new Error("Parameters field is not a JSON object.");
  }

  // Case 2 & 3: Parameters has "Payload" field
  if ("Payload" in step.Parameters) {
    const payload = step.Parameters.Payload;

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
      throw new Error("Parameters.Payload may include custom Execution, State or StateMachine field.");
    }

    // Case 2.2: "Payload" object has no Execution, State or StateMachine field
    payload["Execution.$"] = "$$.Execution";
    payload["State.$"] = "$$.State";
    payload["StateMachine.$"] = "$$.StateMachine";
  }

  // Case 4: Parameters has "Payload.$" field. This should be rare, so we don't support this case for now.
  if ("Payload.$" in step.Parameters) {
    throw new Error("Parameters.Payload has a Payload.$ field.");
  }

  // Case 1: No "Payload" or "Payload.$"
  step.Parameters!["Payload.$"] = "$$['Execution', 'State', 'StateMachine']";
}

/**
 * Modify the definition of a Step Function invocation step to allow merging a Step Function's traces with its downstream
 * Step Function's traces.
 * In case of failure, throw an error.
 *
 * Truth table
 * Case | Input                                                    | Expected
 * -----|----------------------------------------------------------|---------
 *  0.1 | Parameters field is not an object                        | false
 *  0.2 | Parameters field has no Input field                      | true
 *  0.3 | Parameters.Input is not an object                        | false
 *   1  | No "CONTEXT" or "CONTEXT.$"                              | true
 *   2  | Has "CONTEXT"                                            | false
 */
export function updateDefinitionForStepFunctionInvocationStep(stepName: string, step: StepFunctionStep): void {
  log.debug(`Setting up trace merging for Step Function Invocation step ${stepName}`);

  const parameters = step?.Parameters;

  // Case 0.1: Parameters field is not an object
  if (typeof parameters !== "object") {
    throw new Error("Parameters field is not an object.");
  }

  // Case 0.2: Parameters field has no Input field
  if (!("Input" in parameters)) {
    parameters.Input = { "CONTEXT.$": "States.JsonMerge($$, $, false)" };
  }

  // Case 0.3: Parameters.Input is not an object
  if (typeof parameters.Input !== "object") {
    throw new Error("Parameters.Input field is not an object.");
  }

  // Case 1: No "CONTEXT" or "CONTEXT.$"
  if (!("CONTEXT" in parameters.Input) && !("CONTEXT.$" in parameters.Input)) {
    parameters.Input["CONTEXT.$"] = "$$['Execution', 'State', 'StateMachine']";
  }

  // Case 2: Has 'CONTEXT' or "CONTEXT.$" field.
  // This should be rare, so we don't support trace merging for this case for now.
  throw new Error("Parameters.Input has a custom CONTEXT field.");
}

function getUnsupportedCaseErrorMessage(resourceType: string): string {
  return `Step Functions Context Object injection skipped. Your Step Function's trace will \
not be merged with downstream ${resourceType}'s traces. To manually merge these traces, check out \
https://docs.datadoghq.com/serverless/step_functions/troubleshooting/. You may also open a feature request in \
https://github.com/DataDog/datadog-cloudformation-macro. In the feature request, please include the \
definition of your Lambda step or Step Function invocation step.\n`;
}
