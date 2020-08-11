import { FunctionProperties, Resources } from "./index";

const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";
export const DD_ACCOUNT_ID = "464622532012";

export enum RuntimeType {
  NODE,
  PYTHON,
  UNSUPPORTED,
}

// Self defined interface that only applies to the macro - the FunctionProperties interface
// defined in index.ts matches the CloudFormation AWS::Lambda::Function Properties interface.
export interface LambdaFunction {
  properties: FunctionProperties;
  key: string;
  runtimeType: RuntimeType;
  runtime: string;
}

const runtimeLookup: { [key: string]: RuntimeType } = {
  "nodejs10.x": RuntimeType.NODE,
  "nodejs12.x": RuntimeType.NODE,
  "nodejs8.10": RuntimeType.NODE,
  "python2.7": RuntimeType.PYTHON,
  "python3.6": RuntimeType.PYTHON,
  "python3.7": RuntimeType.PYTHON,
  "python3.8": RuntimeType.PYTHON,
};

const runtimeToLayerName: { [key: string]: string } = {
  "nodejs8.10": "Datadog-Node8-10",
  "nodejs10.x": "Datadog-Node10-x",
  "nodejs12.x": "Datadog-Node12-x",
  "python2.7": "Datadog-Python27",
  "python3.6": "Datadog-Python36",
  "python3.7": "Datadog-Python37",
  "python3.8": "Datadog-Python38",
};

const availableRegions = new Set([
  "us-east-2",
  "us-east-1",
  "us-west-1",
  "us-west-2",
  "ap-east-1",
  "ap-south-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ca-central-1",
  "eu-north-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "sa-east-1",
]);

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

      const properties: FunctionProperties = resource.Properties;
      const runtime = properties.Runtime;
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

/**
 * Apply the provided Lambda layer that corresponds to each Lambda's runtime.
 * If a Lambda layer for a given runtime is required but not provided, store an error message with
 * that Lambda function's logical id. Return all errors, so that customer can see if they are
 * missing more than one required Lambda layer.
 */
export function applyLayers(
  region: string,
  lambdas: LambdaFunction[],
  pythonLibraryVersion?: number,
  nodeLibraryVersion?: number,
) {
  if (!availableRegions.has(region)) {
    return [];
  }

  const errors: string[] = [];
  lambdas.forEach((lambda) => {
    if (lambda.runtimeType === RuntimeType.UNSUPPORTED) {
      return;
    }

    let layerARN;

    if (lambda.runtimeType === RuntimeType.PYTHON) {
      if (pythonLibraryVersion === undefined) {
        errors.push(getMissingLibraryVersionErrorMsg(lambda.key, "Python", "python"));
        return;
      }
      layerARN = getLayerARN(region, pythonLibraryVersion, lambda.runtime);
    }

    if (lambda.runtimeType === RuntimeType.NODE) {
      if (nodeLibraryVersion === undefined) {
        errors.push(getMissingLibraryVersionErrorMsg(lambda.key, "Node.js", "node"));
        return;
      }
      layerARN = getLayerARN(region, nodeLibraryVersion, lambda.runtime);
    }

    if (layerARN !== undefined) {
      const currentLayers = lambda.properties.Layers ?? [];
      if (!new Set(currentLayers).has(layerARN)) {
        currentLayers.push(layerARN);
      }
      lambda.properties.Layers = currentLayers;
    }
  });
  return errors;
}

function getLayerARN(region: string, version: number, runtime: string) {
  const layerName = runtimeToLayerName[runtime];
  return `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:${layerName}:${version}`;
}

export function getMissingLibraryVersionErrorMsg(functionKey: string, formalRuntime: string, paramRuntime: string) {
  return (
    `Resource ${functionKey} has a ${formalRuntime} runtime, but no ${formalRuntime} Lambda Library version was provided. ` +
    `Please add the '${paramRuntime}LibraryVersion' parameter for the Datadog serverless macro.`
  );
}
