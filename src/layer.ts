import { FunctionProperties, Resources } from "./index";

const RUNTIME = "Runtime";
const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";

export enum RuntimeType {
  NODE,
  PYTHON,
  UNSUPPORTED,
}

// Self defined interface that only applies to the macro - the FunctionProperties interface
// matches the CloudFormation AWS::Lambda::Function Properties interface.
export interface LambdaFunction {
  properties: FunctionProperties;
  key: string;
  runtimeType: RuntimeType;
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

/**
 * Parse through the Resources section of the provided CloudFormation template to find all lambda
 * function resources. Several modifications will be made later on to these resources, and
 * storing them with a clearly defined interface will make it easier to implement changes.
 *
 * Also assigns a general runtime type to the output lambdas. This helps to determine which lambda
 * layers to add & which handler to redirect to later on in the macro.
 */
export function findLambdas(resources: Resources) {
  return Object.entries(resources)
    .map(([key, resource]) => {
      if (resource.Type !== LAMBDA_FUNCTION_RESOURCE_TYPE) {
        return;
      }

      const properties = resource.Properties;
      let runtime = properties[RUNTIME];
      let runtimeType = RuntimeType.UNSUPPORTED;

      if (runtime !== undefined && runtime in runtimeLookup) {
        runtimeType = runtimeLookup[runtime];
      }

      return {
        properties,
        key,
        runtimeType,
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
    if (lambda.runtimeType === RuntimeType.UNSUPPORTED) {
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
