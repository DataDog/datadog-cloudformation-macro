import * as layers from "./layers.json";

import {
  getConfigFromMappings,
  getConfigFromParams,
  setEnvConfiguration,
} from "./env";
import { findLambdas, applyLayers, LambdaFunction } from "./layer";
import { getTracingMode, enableTracing, MissingIamRoleError } from "./tracing";
import { addServiceAndEnvTags } from "./tags";
import { redirectHandlers } from "./redirect";
import { addCloudWatchForwarderSubscriptions } from "./forwarder";
import { CloudWatchLogs } from "aws-sdk";

export const RESOURCES = "Resources";
const SUCCESS = "success";
const FAILURE = "failure";
export const TYPE = "Type";
export const PROPERTIES = "Properties";

interface CfnTemplate {
  Mappings?: any;
  Resources: any;
}

interface InputEvent {
  region: string;
  accountId: string;
  fragment: CfnTemplate;
  transformId: string; // Name of the macro
  params: { [key: string]: any };
  requestId: string;
  templateParameterValues: { [key: string]: any };
}

export interface FunctionProperties {
  Handler: string;
  Runtime: string;
  Role: string | { [func: string]: string[] };
  Code: any;
  Environment?: { Variables?: { [key: string]: string | boolean } };
  Tags?: { Value: string; Key: string }[];
  Layers?: string[];
  TracingConfig?: { [key: string]: string };
  FunctionName?: string;
}

export const handler = async (event: InputEvent, _: any) => {
  const region = event.region;
  const fragment = event.fragment;
  const resources = fragment.Resources;
  const lambdas = findLambdas(resources);

  let config;
  const transformParams = event.params;
  if (Object.keys(transformParams).length > 0) {
    config = getConfigFromParams(transformParams);
  } else {
    config = getConfigFromMappings(fragment.Mappings);
  }
  setEnvConfiguration(config, lambdas);

  // Apply layers
  if (config.addLayers) {
    applyLayers(region, lambdas, layers);
  }

  // Enable tracing
  const tracingMode = getTracingMode(config);
  try {
    enableTracing(tracingMode, lambdas, resources);
  } catch (err) {
    if (err instanceof MissingIamRoleError) {
      return {
        requestId: event.requestId,
        status: FAILURE,
        fragment,
        errorMessage: err.message,
      };
    }
  }

  // Cloudwatch forwarder subscriptions
  if (config.forwarder) {
    const dynamicallyNamedLambdas = lambdaHasDynamicallyGeneratedName(lambdas);
    if (dynamicallyNamedLambdas.length > 0 && config.stackName === undefined) {
      const lambdaKeys = dynamicallyNamedLambdas.map((lambda) => lambda.key);
      const errorMessage = getMissingStackNameErrorMsg(lambdaKeys);
      return {
        requestId: event.requestId,
        status: FAILURE,
        fragment,
        errorMessage,
      };
    }

    const cloudWatchLogs = new CloudWatchLogs({ region });
    await addCloudWatchForwarderSubscriptions(
      resources,
      lambdas,
      config.stackName,
      config.forwarder,
      cloudWatchLogs
    );
  }

  // Add service & env tags if values are provided
  if (config.service || config.env) {
    addServiceAndEnvTags(lambdas, config.service, config.env);
  }

  // Redirect handlers
  redirectHandlers(lambdas, config.addLayers);

  return {
    requestId: event.requestId,
    status: SUCCESS,
    fragment,
  };
};

/**
 * Returns true if one or more lambda resources in the provided template is missing
 * the 'FunctionName' property. In this case, it means at least one of the names
 * will be dynamically generated.
 */
function lambdaHasDynamicallyGeneratedName(lambdas: LambdaFunction[]) {
  const dynmicallyNamedLambdas: LambdaFunction[] = [];
  for (const lambda of lambdas) {
    if (lambda.properties.FunctionName === undefined) {
      dynmicallyNamedLambdas.push(lambda);
    }
  }
  return dynmicallyNamedLambdas;
}

export function getMissingStackNameErrorMsg(lambdaKeys: string[]) {
  return (
    "A forwarder ARN was provided with one or more dynamically named lambda function resources, " +
    "but the stack name was not provided. Without the stack name, " +
    "the dynamically generated function cannot be predicted and corresponding CloudWatch subscriptions cannot be added." +
    "To fix this, either add 'stackName: ${AWS::StackName}' under the Datadog macro parameters, " +
    `or add a 'FunctionName' property to the following resources: ${lambdaKeys.toString()}`
  );
}
