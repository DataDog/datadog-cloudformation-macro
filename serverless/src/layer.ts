import { FunctionProperties, Resources, Parameters, LambdaLayersProperty, CFN_IF_FUNCTION_STRING } from "./index";
import log from "loglevel";

const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";
export const DD_ACCOUNT_ID = "464622532012";
export const DD_GOV_ACCOUNT_ID = "002406178527";

export enum RuntimeType {
  NODE,
  PYTHON,
  UNSUPPORTED,
}

export enum ArchitectureType {
  ARM64,
  x86_64,
}

// Self defined interface that only applies to the macro - the FunctionProperties interface
// defined in index.ts matches the CloudFormation AWS::Lambda::Function Properties interface.
export interface LambdaFunction {
  properties: FunctionProperties;
  key: string;
  runtimeType: RuntimeType;
  runtime: string;
  architectureType: ArchitectureType;
  architecture: string;
}

const architectureLookup: { [key: string]: ArchitectureType } = {
  x86_64: ArchitectureType.x86_64,
  arm64: ArchitectureType.ARM64,
};

const architectureToExtensionLayerName: { [key: string]: string } = {
  x86_64: "Datadog-Extension",
  arm64: "Datadog-Extension-ARM",
};

export const runtimeLookup: { [key: string]: RuntimeType } = {
  "nodejs12.x": RuntimeType.NODE,
  "nodejs14.x": RuntimeType.NODE,
  "nodejs16.x": RuntimeType.NODE,
  "nodejs18.x": RuntimeType.NODE,
  "nodejs20.x": RuntimeType.NODE,
  "python2.7": RuntimeType.PYTHON,
  "python3.6": RuntimeType.PYTHON,
  "python3.7": RuntimeType.PYTHON,
  "python3.8": RuntimeType.PYTHON,
  "python3.9": RuntimeType.PYTHON,
  "python3.10": RuntimeType.PYTHON,
  "python3.11": RuntimeType.PYTHON,
  "python3.12": RuntimeType.PYTHON,
};

export const layerNameLookup: { [key in ArchitectureType]: { [key: string]: string } } = {
  [ArchitectureType.x86_64]: {
    "nodejs12.x": "Datadog-Node12-x",
    "nodejs14.x": "Datadog-Node14-x",
    "nodejs16.x": "Datadog-Node16-x",
    "nodejs18.x": "Datadog-Node18-x",
    "nodejs20.x": "Datadog-Node20-x",
    "python2.7": "Datadog-Python27",
    "python3.6": "Datadog-Python36",
    "python3.7": "Datadog-Python37",
    "python3.8": "Datadog-Python38",
    "python3.9": "Datadog-Python39",
    "python3.10": "Datadog-Python310",
    "python3.11": "Datadog-Python311",
    "python3.12": "Datadog-Python312",
  },
  [ArchitectureType.ARM64]: {
    "nodejs12.x": "Datadog-Node12-x",
    "nodejs14.x": "Datadog-Node14-x",
    "nodejs16.x": "Datadog-Node16-x",
    "nodejs18.x": "Datadog-Node18-x",
    "nodejs20.x": "Datadog-Node20-x",
    "python3.8": "Datadog-Python38-ARM",
    "python3.9": "Datadog-Python39-ARM",
    "python3.10": "Datadog-Python310-ARM",
    "python3.11": "Datadog-Python311-ARM",
    "python3.12": "Datadog-Python312-ARM",
  }
}

/**
 * Parse through the Resources section of the provided CloudFormation template to find all lambda
 * function resources. Several modifications will be made later on to these resources, and
 * storing them with a clearly defined interface will make it easier to implement changes.
 *
 * Also assigns a general runtime type to the output lambdas. This helps to determine which lambda
 * layers to add & which handler to redirect to later on in the macro.
 */
export function findLambdas(resources: Resources, templateParameterValues: Parameters) {
  return Object.entries(resources)
    .map(([key, resource]) => {
      if (resource.Type !== LAMBDA_FUNCTION_RESOURCE_TYPE) {
        log.debug(`Resource ${key} is not a Lambda function, skipping...`);
        return;
      }

      const properties: FunctionProperties = resource.Properties;
      const runtime = useOrRef(properties.Runtime, templateParameterValues);
      const architecture = useOrRef(properties.Architectures?.[0], templateParameterValues) ?? "x86_64";

      let runtimeType = RuntimeType.UNSUPPORTED;
      let architectureType = ArchitectureType.x86_64;

      if (runtime !== undefined && runtime in runtimeLookup) {
        runtimeType = runtimeLookup[runtime];
      }
      if (architecture !== undefined && architecture in architectureLookup) {
        architectureType = architectureLookup[architecture];
      }

      return {
        properties,
        key,
        runtimeType,
        runtime,
        architecture,
        architectureType,
      } as LambdaFunction;
    })
    .filter((lambda) => lambda !== undefined) as LambdaFunction[];
}

function useOrRef(value: undefined | string | { Ref: any }, templateParameterValues: Parameters): undefined | string {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return templateParameterValues[value.Ref] ?? value;
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
      lambdaLibraryLayerArn = getLambdaLibraryLayerArn(region, pythonLayerVersion, lambda.runtime, lambda.architecture);
      addLayer(lambdaLibraryLayerArn, lambda);
    }

    if (lambda.runtimeType === RuntimeType.NODE) {
      if (nodeLayerVersion === undefined) {
        errors.push(getMissingLayerVersionErrorMsg(lambda.key, "Node.js", "node"));
        return;
      }

      log.debug(`Setting Node Lambda layer for ${lambda.key}`);
      lambdaLibraryLayerArn = getLambdaLibraryLayerArn(region, nodeLayerVersion, lambda.runtime, lambda.architecture);
      addLayer(lambdaLibraryLayerArn, lambda);
    }

    if (extensionLayerVersion !== undefined) {
      log.debug(`Setting Lambda Extension layer for ${lambda.key}`);
      lambdaExtensionLayerArn = getExtensionLayerArn(region, extensionLayerVersion, lambda.architecture);
      addLayer(lambdaExtensionLayerArn, lambda);
    }
  });
  return errors;
}

function addLayer(layerArn: string, lambda: LambdaFunction) {
  if (layerArn === undefined) {
    return;
  }

  const currentLayers = lambda.properties.Layers ?? [];
  const newLayers = getNewLayers(layerArn, currentLayers);
  lambda.properties.Layers = newLayers;
}

// Return the layers arr or object with layerArn added
export function getNewLayers(layerArn: string, currentLayers: LambdaLayersProperty): LambdaLayersProperty {
  if (Array.isArray(currentLayers)) {
    if (currentLayers.includes(layerArn)) {
      // Don't change layers if the layerArn is already present
      return currentLayers;
    }
    return [...currentLayers, layerArn];
  }

  // CFN Fn::If conditional values are arrays with three items:
  // 1. condition, 2. output if condition is true, 3. output if false
  const conditionalValues = currentLayers[CFN_IF_FUNCTION_STRING];

  // If this is not an if statement, log a warning and do not add layer
  if (conditionalValues === undefined) {
    console.warn("Unrecognized object in Layers definition. Cannot " + `add layer ${layerArn}`);
    return currentLayers;
  }

  if (conditionalValues.length !== 3) {
    console.warn("Conditional in Layers definition does not have 3 items. Cannot " + `add layer ${layerArn}`);
    return currentLayers;
  }
  const [conditionalName, layersIfTrue, layersIfFalse] = conditionalValues;

  const newLayersIfTrue = getNewLayers(layerArn, layersIfTrue);
  const newLayersIfFalse = getNewLayers(layerArn, layersIfFalse);

  return { [CFN_IF_FUNCTION_STRING]: [conditionalName, newLayersIfTrue, newLayersIfFalse] };
}

export function getLambdaLibraryLayerArn(region: string, version: number, runtime: string, architecture: string) {
  const layerName = layerNameLookup[architectureLookup[architecture]][runtime];
  const isGovCloud = region === "us-gov-east-1" || region === "us-gov-west-1";

  // if this is a GovCloud region, use the GovCloud lambda layer
  if (isGovCloud) {
    log.debug("GovCloud region detected, using GovCloud Lambda layer");
    return `arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:${layerName}:${version}`;
  }
  return `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:${layerName}:${version}`;
}

export function getExtensionLayerArn(region: string, version: number, architecture: string) {
  const layerName = architectureToExtensionLayerName[architecture];

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
