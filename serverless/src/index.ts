import { getConfigFromCfnMappings, getConfigFromCfnParams, validateParameters, Configuration } from "./lambda/env";
import { instrumentLambdas } from "./lambda/lambda";
import { instrumentStateMachines } from "./step_function/step_function";
import { InputEvent, OutputEvent, SUCCESS, FAILURE } from "./types";
import log from "loglevel";

export const handler = async (event: InputEvent, _: any): Promise<OutputEvent> => {
  try {
    /* TODO: set loglevel here using config or env var */
    log.setLevel("debug");

    const fragment = event.fragment;

    let config: Configuration;
    // Use the parameters given for this specific transform/macro if it exists
    const transformParams = event.params ?? {};
    if (Object.keys(transformParams).length > 0) {
      log.debug("Parsing config from CloudFormation transform/macro parameters");
      config = getConfigFromCfnParams(transformParams);
    } else {
      // If not, check the Mappings section for Datadog config parameters as well
      log.debug("Parsing config from CloudFormation template mappings");
      config = getConfigFromCfnMappings(fragment.Mappings);
    }

    const errors = validateParameters(config);
    if (errors.length > 0) {
      return {
        requestId: event.requestId,
        status: FAILURE,
        fragment,
        errorMessage: errors.join("\n"),
      };
    }

    const lambdaOutput = await instrumentLambdas(event, config);
    if (lambdaOutput.status === FAILURE) {
      return lambdaOutput;
    }

    const stepFunctionOutput = await instrumentStateMachines(event);
    if (stepFunctionOutput.status === FAILURE) {
      return stepFunctionOutput;
    }

    return {
      requestId: event.requestId,
      status: SUCCESS,
      fragment,
    };
  } catch (error: any) {
    return {
      requestId: event.requestId,
      status: FAILURE,
      fragment: event.fragment,
      errorMessage: error.message,
    };
  }
};
