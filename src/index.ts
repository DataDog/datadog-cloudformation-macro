import * as layers from "./layers.json";

import { getConfig, setEnvConfiguration } from "./env";
import { findLambdas, applyLayers } from "./layer";
import { getTracingMode, enableTracing } from "./tracing";
import { addEnvTag } from "./tags";
import { redirectHandlers } from "./redirect";

const RESOURCES = "Resources";
const REGION = "region";
const FRAGMENT = "fragment";
const REQUEST_ID = "requestId";
const MAPPINGS = "Mappings";
const SUCCESS = "success";
const GLOBALS = "Globals";
export const TYPE = "Type";
export const PROPERTIES = "Properties";

export interface FunctionDefinition {
  Handler: string;
  Runtime: string;
  Role: string | { [func: string]: string[] };
  Environment?: { Variables?: { [key: string]: string | boolean } };
  Tags?: { Value: string; Key: string }[];
  Layers?: string[];
  TracingConfig?: { [key: string]: string };
}

export const handler = async (event: any, context: any) => {
  const fragment = event[FRAGMENT];
  const resources = fragment[RESOURCES];
  const lambdas = findLambdas(resources);

  const config = getConfig(event[MAPPINGS]);
  setEnvConfiguration(config, lambdas);

  // Apply layers
  if (config.addLayers) {
    applyLayers(event[REGION], lambdas, layers, resources);
  }

  // Enable tracing
  const tracingMode = getTracingMode(config);
  enableTracing(tracingMode, fragment, lambdas);

  // Add env tag if possible
  if (config.enableEnvTag) {
    addEnvTag(event[GLOBALS], resources, lambdas);
  }

  // Redirect handlers
  redirectHandlers(lambdas);

  return {
    requestId: event[REQUEST_ID],
    status: SUCCESS,
    fragment: event[FRAGMENT],
  };
};
