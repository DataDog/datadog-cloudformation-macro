import { Resources } from "../common/types";
import { StateMachine, StateMachineProperties, StateMachineDefinition, StateMachineState } from "./types";
import log from "loglevel";

// Format of definition or definitionString field in state machine properties
// For more about Fn::Sub, see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-sub.html
enum StateMachineDefinitionFormat {
  // definition field is an object
  OBJECT = "OBJECT",
  // definitionString field is a plain string
  STRING = "STRING",
  // definitionString is {"Fn::Sub": string}
  FN_SUB_WITH_STRING = "FN_SUB_WITH_STRING",
  // definitionString is { "Fn::Sub": (string | object)[] }
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

  // Step 1: Parse definition object from definition string
  let definitionObj: StateMachineDefinition;
  let definitionFormat: StateMachineDefinitionFormat;

  try {
    [definitionObj, definitionFormat] = parseDefinitionObject(stateMachine.properties);
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
    } else if (isStepFunctionInvocationStep(step?.Resource)) {
      try {
        updateDefinitionForStepFunctionInvocationStep(stepName, step);
      } catch (error) {
        log.warn(error + " " + getUnsupportedCaseErrorMessage("Step Function"));
      }
    }
  }

  // Step 3: Write back the definition to the state machine
  updateDefinition(definitionObj, definitionFormat, stateMachine.properties);

  return true;
}

function parseDefinitionObject(
  properties: StateMachineProperties,
): [StateMachineDefinition, StateMachineDefinitionFormat] {
  // First check Definition field
  if (properties.Definition) {
    // Case 4: definition field is an object
    return [properties.Definition as StateMachineDefinition, StateMachineDefinitionFormat.OBJECT];
  }

  // Then check DefinitionString field
  let definitionFormat: StateMachineDefinitionFormat;
  let definitionObj;

  const definitionString = properties.DefinitionString;
  if (definitionString === undefined) {
    throw new Error("The state machine's has no Definition or DefinitionString field.");
  }

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

/**
 * Writes the updated definition object back to the state machine properties.
 */
function updateDefinition(
  definitionObj: StateMachineDefinition,
  definitionFormat: StateMachineDefinitionFormat,
  properties: StateMachineProperties,
): void {
  switch (definitionFormat) {
    case StateMachineDefinitionFormat.STRING:
      properties.DefinitionString = JSON.stringify(definitionObj);
      break;
    case StateMachineDefinitionFormat.FN_SUB_WITH_STRING:
      properties.DefinitionString = { "Fn::Sub": JSON.stringify(definitionObj) };
      break;
    case StateMachineDefinitionFormat.FN_SUB_WITH_ARRAY:
      (properties.DefinitionString as { "Fn::Sub": (string | object)[] })["Fn::Sub"][0] = JSON.stringify(definitionObj);
      break;
    case StateMachineDefinitionFormat.OBJECT:
      properties.Definition = definitionObj;
      break;
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

function isStepFunctionInvocationStep(resource: string | undefined): boolean {
  if (resource === undefined) {
    return false;
  }
  return resource.startsWith("arn:aws:states:::states:startExecution");
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
export function updateDefinitionForStepFunctionInvocationStep(stepName: string, state: StateMachineState): void {
  log.debug(`Setting up trace merging for Step Function Invocation step ${stepName}`);
  const parameters = state?.Parameters;
  // Case 0.1: Parameters field is not an object
  if (typeof parameters !== "object") {
    throw new Error("Parameters field is not an object.");
  }
  // Case 0.2: Parameters field has no Input field
  if (!("Input" in parameters)) {
    parameters.Input = { "CONTEXT.$": "States.JsonMerge($$, $, false)" };
    return;
  }
  // Case 0.3: Parameters.Input is not an object
  if (typeof parameters.Input !== "object") {
    throw new Error("Parameters.Input field is not an object.");
  }
  // Case 1: No "CONTEXT" or "CONTEXT.$"
  if (!("CONTEXT" in parameters.Input) && !("CONTEXT.$" in parameters.Input)) {
    parameters.Input["CONTEXT.$"] = "$$['Execution', 'State', 'StateMachine']";
    return;
  }
  // Case 2: Has 'CONTEXT' or "CONTEXT.$" field.
  // This should be rare, so we don't support trace merging for this case for now.
  throw new Error("Parameters.Input has a custom CONTEXT field.");
}
