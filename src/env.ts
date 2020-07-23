import { LambdaFunction } from "./layer";

export interface Configuration {
  // Whether to add the lambda layers, or expect the user's to bring their own
  addLayers: boolean;
  // Datadog API Key, only necessary when using metrics without log forwarding
  apiKey?: string;
  // Datadog API Key encrypted using KMS, only necessary when using metrics without log forwarding
  apiKMSKey?: string;
  // Which Site to send to, (should be datadoghq.com or datadoghq.eu)
  site: string;
  // The log level, (set to DEBUG for extended logging)
  logLevel: string;
  // Whether the log forwarder integration is enabled by default
  flushMetricsToLogs: boolean;
  // Enable tracing on Lambda functions and API Gateway integrations using X-Ray. Defaults to true
  enableXrayTracing: boolean;
  // Enable tracing on Lambda function using dd-trace, datadog's APM library.
  enableDDTracing: boolean;
  // When set, the macro will subscribe the lambdas to the forwarder with the given arn.
  forwarderArn?: string;
  // Enable enhanced metrics on Lambda functions. Defaults to true.
  enableEnhancedMetrics: boolean;
  // When set, the macro will use this value to add the 'service' tag to all lambdas,
  // but will not override existing 'service' tags on individual lambdas or those set in Globals.
  service?: string;
  // When set, the macro will use this value to add the 'env' tag to all lambdas,
  // but will not override existing 'env' tags on individual lambdas or those set in Globals.
  env?: string;
  // If a forwarder is provided and any lambdas have dynamically generated names,
  // the stack name will be required to create the necessary CloudWatch subscriptions.
  // If a forwarder is provided with dynamically named lambdas, and a stack name is not provided,
  // the subscription will not be added.
  stackName?: string;
}

// Same interface as Configuration above, except all parameters are optional, since user does
// not have to provide the values (in which case we will use the default configuration below).
interface CfnParams {
  addLayers?: boolean;
  apiKey?: string;
  apiKMSKey?: string;
  site?: string;
  logLevel?: string;
  flushMetricsToLogs?: boolean;
  enableXrayTracing?: boolean;
  enableDDTracing?: boolean;
  forwarderArn?: string;
  enableEnhancedMetrics?: boolean;
  service?: string;
  env?: string;
  stackName?: string;
}

const apiKeyEnvVar = "DD_API_KEY";
const apiKeyKMSEnvVar = "DD_KMS_API_KEY";
const siteURLEnvVar = "DD_SITE";
const logLevelEnvVar = "DD_LOG_LEVEL";
const logForwardingEnvVar = "DD_FLUSH_TO_LOG";
const enhancedMetricsEnvVar = "DD_ENHANCED_METRICS";
const DATADOG = "Datadog";
const PARAMETERS = "Parameters";

export const defaultConfiguration: Configuration = {
  addLayers: true,
  flushMetricsToLogs: true,
  logLevel: "info",
  site: "datadoghq.com",
  enableXrayTracing: true,
  enableDDTracing: true,
  enableEnhancedMetrics: true,
};

/**
 * Parses the Mappings section for Datadog config parameters.
 * Assumes that the parameters live under the Mappings section in this format:
 *
 * Mappings:
 *  Datadog:
 *    Parameters:
 *      addLayers: true
 *      ...
 */
export function getConfigFromCfnMappings(mappings: any): Configuration {
  if (mappings === undefined || mappings[DATADOG] === undefined) {
    return defaultConfiguration;
  }
  return getConfigFromCfnParams(mappings[DATADOG][PARAMETERS]);
}

/**
 * Takes a set of parameters from the CloudFormation template. This could come from either
 * the Mappings section of the template, or directly from the Parameters under the transform/macro
 * as the 'params' property under the original InputEvent to the handler in src/index.ts
 *
 * Uses these parameters as the Datadog configuration, and for values that are required in the
 * configuration but not provided in the parameters, uses the default values from
 * the defaultConfiguration above.
 */
export function getConfigFromCfnParams(params: CfnParams) {
  let datadogConfig = params as Partial<Configuration> | undefined;
  if (datadogConfig === undefined) {
    datadogConfig = {};
  }
  return {
    ...defaultConfiguration,
    ...datadogConfig,
  };
}

export function setEnvConfiguration(
  config: Configuration,
  lambdas: LambdaFunction[]
) {
  lambdas.forEach((lambda) => {
    const environment = lambda.properties.Environment ?? {};
    const envVariables = environment.Variables ?? {};

    if (
      config.apiKey !== undefined &&
      envVariables[apiKeyEnvVar] === undefined
    ) {
      envVariables[apiKeyEnvVar] = config.apiKey;
    }
    if (
      config.apiKMSKey !== undefined &&
      envVariables[apiKeyKMSEnvVar] === undefined
    ) {
      envVariables[apiKeyKMSEnvVar] = config.apiKMSKey;
    }
    if (envVariables[siteURLEnvVar] === undefined) {
      envVariables[siteURLEnvVar] = config.site;
    }
    if (envVariables[logLevelEnvVar] === undefined) {
      envVariables[logLevelEnvVar] = config.logLevel;
    }
    if (envVariables[logForwardingEnvVar] === undefined) {
      envVariables[logForwardingEnvVar] = config.flushMetricsToLogs;
    }
    if (envVariables[enhancedMetricsEnvVar] === undefined) {
      envVariables[enhancedMetricsEnvVar] = config.enableEnhancedMetrics;
    }

    environment.Variables = envVariables;
    lambda.properties.Environment = environment;
  });
}
