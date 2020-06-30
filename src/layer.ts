import { FunctionDefinition } from "./index";

const TYPE = "Type";
const RUNTIME = "Runtime";
const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";
const LAYERS = "Layers";
const PROPERTIES = "Properties";

export enum RuntimeType {
  NODE,
  PYTHON,
  UNSUPPORTED,
}

export interface FunctionInfo {
  lambda: FunctionDefinition;
  name: string;
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
  return Object.keys(resources)
    .map((resourceKey) => {
      const resource = resources[resourceKey];
      const resourceType: string = resource[TYPE] ?? "";
      if (resourceType !== LAMBDA_FUNCTION_RESOURCE_TYPE) {
        return;
      }

      const lambda = resource[PROPERTIES];
      let runtime = lambda[RUNTIME];
      let type = RuntimeType.UNSUPPORTED;

      // TODO: determine default runtime?

      if (runtime !== undefined && runtime in runtimeLookup) {
        type = runtimeLookup[runtime];
      }

      return {
        lambda: resource[PROPERTIES],
        name: resourceKey,
        type: type,
        runtime: runtime,
      } as FunctionInfo;
    })
    .filter((lambda) => lambda !== undefined) as FunctionInfo[];
}

export function applyLayers(
  region: string,
  lambdas: FunctionInfo[],
  layers: LayerJSON,
  resources: any
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
      const lambdaProperties: any = resources[lambda.name][PROPERTIES];
      const currentLayers = lambdaProperties[LAYERS] ?? [];
      if (!new Set(currentLayers).has(layerARN)) {
        currentLayers.push(layerARN);
      }
      lambdaProperties[LAYERS] = currentLayers;
    }
  });
}
