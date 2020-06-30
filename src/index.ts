import * as layers from "./layers.json";

import { findLambdas, applyLayers } from "./layer";
import { redirectHandlers } from "redirect";

const RESOURCES = "Resources";
const REGION = "region";
const FRAGMENT = "fragment";
const REQUEST_ID = "requestId";
const SUCCESS = "success";

export interface FunctionDefinition {
  Handler: string;
  Runtime?: string;
  Timeout?: number;
  MemorySize?: number;
  Environment?: { Variables?: { [key: string]: string } };
  Tags?: { [key: string]: string };
  Layers?: string[];
  TracingConfig?: { [key: string]: string };
}

export const handler = async (event: any, context: any) => {
  const fragment = event[FRAGMENT];
  const resources = fragment[RESOURCES];

  // Apply layers
  const lambdas = findLambdas(resources);
  applyLayers(event[REGION], lambdas, layers, resources);

  // Redirect handlers
  redirectHandlers(lambdas);

  return {
    requestId: event[REQUEST_ID],
    status: SUCCESS,
    fragment: event[FRAGMENT],
  };
};
