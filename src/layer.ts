import { FunctionProperties, TYPE, PROPERTIES } from "./index";

const RUNTIME = "Runtime";
const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";

export enum RuntimeType {
  NODE,
  PYTHON,
  UNSUPPORTED,
}

export interface LambdaFunction {
  properties: FunctionProperties;
  key: string;
  type: RuntimeType;
  runtime: string;
}

export interface LayerJSON {
  regions: {
    [region: string]: { [runtime: string]: string | undefined } | undefined;
  };
}

export const runtimeLookup: { [key: string]: RuntimeType } = {
  "nodejs10.x": RuntimeType.NODE,
  "nodejs12.x": RuntimeType.NODE,
  "nodejs8.10": RuntimeType.NODE,
  "python2.7": RuntimeType.PYTHON,
  "python3.6": RuntimeType.PYTHON,
  "python3.7": RuntimeType.PYTHON,
  "python3.8": RuntimeType.PYTHON,
};

export function findLambdas(resources: any) {
  return Object.entries(resources)
    .map(([key, resource]: [string, any]) => {
      if (resource[TYPE] !== LAMBDA_FUNCTION_RESOURCE_TYPE) {
        return;
      }

      const lambda = resource[PROPERTIES];
      let runtime = lambda[RUNTIME];
      let type = RuntimeType.UNSUPPORTED;

      if (runtime !== undefined && runtime in runtimeLookup) {
        type = runtimeLookup[runtime];
      }

      return {
        properties: resource[PROPERTIES],
        key,
        type,
        runtime,
      } as LambdaFunction;
    })
    .filter((lambda) => lambda !== undefined) as LambdaFunction[];
}

export function applyLayers(
  region: string,
  lambdas: LambdaFunction[],
  layers: LayerJSON
) {
  const regionRuntimes = layers.regions[region];
  if (regionRuntimes === undefined) {
    return;
  }

  lambdas.forEach((lambda) => {
    if (lambda.type === RuntimeType.UNSUPPORTED) {
      return;
    }
    const runtime = lambda.runtime;
    const layerARN =
      runtime !== undefined ? regionRuntimes[runtime] : undefined;
    if (layerARN !== undefined) {
      const currentLayers = lambda.properties.Layers ?? [];
      if (!new Set(currentLayers).has(layerARN)) {
        currentLayers.push(layerARN);
      }
      lambda.properties.Layers = currentLayers;
    }
  });
}
