import * as layers from "./layers.json";

import {
  getConfigFromMappings,
  getConfigFromParams,
  setEnvConfiguration,
} from "./env";
import { findLambdas, applyLayers } from "./layer";
import { getTracingMode, enableTracing } from "./tracing";
import { addServiceAndEnvTags } from "./tags";
import { redirectHandlers } from "./redirect";
import { addCloudWatchForwarderSubscriptions } from "./forwarder";

const RESOURCES = "Resources";
const REGION = "region";
const FRAGMENT = "fragment";
const PARAMS = "params";
const REQUEST_ID = "requestId";
const MAPPINGS = "Mappings";
const SUCCESS = "success";
const GLOBALS = "Globals";
export const TYPE = "Type";
export const PROPERTIES = "Properties";

export interface FunctionProperties {
  Handler: string;
  Runtime: string;
  Role: string | { [func: string]: string[] };
  Environment?: { Variables?: { [key: string]: string | boolean } };
  Tags?: { Value: string; Key: string }[];
  Layers?: string[];
  TracingConfig?: { [key: string]: string };
  FunctionName?: string;
}

export const handler = async (event: any, _: any) => {
  const region = event[REGION];
  const fragment = event[FRAGMENT];
  const resources = fragment[RESOURCES];
  const lambdas = findLambdas(resources);

  let config;
  const transformParams = event[PARAMS];
  if (transformParams !== undefined) {
    config = getConfigFromParams(transformParams);
  } else {
    config = getConfigFromMappings(fragment[MAPPINGS]);
  }
  setEnvConfiguration(config, lambdas);

  // Apply layers
  if (config.addLayers) {
    applyLayers(region, lambdas, layers, resources);
  }

  // Enable tracing
  const tracingMode = getTracingMode(config);
  enableTracing(tracingMode, fragment, lambdas);

  // Cloudwatch forwarder subscriptions
  if (config.forwarder) {
    await addCloudWatchForwarderSubscriptions(
      resources,
      lambdas,
      config.stackName,
      config.forwarder,
      region
    );
  }

  // Add service & env tags if values are provided
  if (config.service || config.env) {
    addServiceAndEnvTags(event[GLOBALS], lambdas, config.service, config.env);
  }

  // Redirect handlers
  redirectHandlers(lambdas);

  return {
    requestId: event[REQUEST_ID],
    status: SUCCESS,
    fragment: event[FRAGMENT],
  };
};
