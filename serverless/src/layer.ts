import { FunctionProperties, Resources } from "./index";
import log from "loglevel";

const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";
export const DD_ACCOUNT_ID = "464622532012";
export const DD_GOV_ACCOUNT_ID = "002406178527";
const DD_LAMBDA_EXTENSION_LAYER_NAME = "Datadog-Extension";

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
  "nodejs14.x": RuntimeType.NODE,
  "python2.7": RuntimeType.PYTHON,
  "python3.6": RuntimeType.PYTHON,
  "python3.7": RuntimeType.PYTHON,
  "python3.8": RuntimeType.PYTHON,
  "python3.9": RuntimeType.PYTHON,
};

const runtimeToLayerName: { [key: string]: string } = {
  "nodejs10.x": "Datadog-Node10-x",
  "nodejs12.x": "Datadog-Node12-x",
  "nodejs14.x": "Datadog-Node14-x",
  "python2.7": "Datadog-Python27",
  "python3.6": "Datadog-Python36",
  "python3.7": "Datadog-Python37",
  "python3.8": "Datadog-Python38",
  "python3.9": "Datadog-Python39",
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
        log.debug(`Resource ${key} is not a Lambda function, skipping...`);
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
  pythonLayerVersion?: number,
  nodeLayerVersion?: number,
  extensionLayerVersion?: number,
) {
  const errors: string[] = [];
  lambdas.forEach((lambda) => {
    if (lambda.runtimeType === RuntimeType.UNSUPPORTED) {
      log.debug(`No Lambda layer available for runtime: ${lambda.runtime}`);
      return;
    }

    let lambdaLibraryLayerArn;
    let lambdaExtensionLayerArn;

    if (lambda.runtimeType === RuntimeType.PYTHON) {
      if (pythonLayerVersion === undefined) {
        errors.push(getMissingLayerVersionErrorMsg(lambda.key, "Python", "python"));
        return;
      }

      log.debug(`Setting Python Lambda layer for ${lambda.key}`);
      lambdaLibraryLayerArn = getLambdaLibraryLayerArn(region, pythonLayerVersion, lambda.runtime);
      addLayer(lambdaLibraryLayerArn, lambda);
    }

    if (lambda.runtimeType === RuntimeType.NODE) {
      if (nodeLayerVersion === undefined) {
        errors.push(getMissingLayerVersionErrorMsg(lambda.key, "Node.js", "node"));
        return;
      }

      log.debug(`Setting Node Lambda layer for ${lambda.key}`);
      lambdaLibraryLayerArn = getLambdaLibraryLayerArn(region, nodeLayerVersion, lambda.runtime);
      addLayer(lambdaLibraryLayerArn, lambda);
    }

    if (extensionLayerVersion !== undefined) {
      log.debug(`Setting Lambda Extension layer for ${lambda.key}`);
      lambdaExtensionLayerArn = getExtensionLayerArn(region, extensionLayerVersion);
      addLayer(lambdaExtensionLayerArn, lambda);
    }
  });
  return errors;
}

function addLayer(layerArn: string, lambda: LambdaFunction) {
  if (layerArn !== undefined) {
    const currentLayers = lambda.properties.Layers ?? [];
    if (!currentLayers.includes(layerArn)) {
      currentLayers.push(layerArn);
    }
    lambda.properties.Layers = currentLayers;
  }
}

export function getLambdaLibraryLayerArn(region: string, version: number, runtime: string) {
  const layerName = runtimeToLayerName[runtime];
  const isGovCloud = region === "us-gov-east-1" || region === "us-gov-west-1";

  // if this is a GovCloud region, use the GovCloud lambda layer
  if (isGovCloud) {
    log.debug("GovCloud region detected, using GovCloud Lambda layer");
    return `arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:${layerName}:${version}`;
  }
  return `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:${layerName}:${version}`;
}

export function getExtensionLayerArn(region: string, version: number) {
  const layerName = DD_LAMBDA_EXTENSION_LAYER_NAME;
  const isGovCloud = region === "us-gov-east-1" || region === "us-gov-west-1";

  // if this is a GovCloud region, use the GovCloud lambda layer
  if (isGovCloud) {
    log.debug("GovCloud region detected, using GovCloud Lambda layer");
    return `arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:${layerName}:${version}`;
  }
  return `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:${layerName}:${version}`;
}

export function getMissingLayerVersionErrorMsg(functionKey: string, formalRuntime: string, paramRuntime: string) {
  return (
    `Resource ${functionKey} has a ${formalRuntime} runtime, but no ${formalRuntime} Lambda Library version was provided. ` +
    `Please add the '${paramRuntime}LayerVersion' parameter for the Datadog serverless macro.`
  );
}
