import { validateParameters as validateLambdaParameters, getConfig as getLambdaConfig } from "./lambda/env";
import { instrumentLambdas } from "./lambda/lambda";
import { InputEvent, OutputEvent, SUCCESS, FAILURE } from "./types";
import { instrumentStateMachines } from "./step_function/step_function";
import log from "loglevel";

export const handler = async (event: InputEvent, _: any): Promise<OutputEvent> => {
  try {
    /* TODO: set loglevel here using config or env var */
    log.setLevel("debug");

    const fragment = event.fragment;

    const lambdaConfig = getLambdaConfig(event);
    const errors = validateLambdaParameters(lambdaConfig);
    if (errors.length > 0) {
      return {
        requestId: event.requestId,
        status: FAILURE,
        fragment,
        errorMessage: errors.join("\n"),
      };
    }

    const lambdaOutput = await instrumentLambdas(event, lambdaConfig);
    if (lambdaOutput.status === FAILURE) {
      return lambdaOutput;
    }

    const stepFunctionOutput = await instrumentStateMachines(event);
    return stepFunctionOutput;
  } catch (error: any) {
    return {
      requestId: event.requestId,
      status: FAILURE,
      fragment: event.fragment,
      errorMessage: error.message,
    };
  }
};
