import { FunctionInfo } from "layer";

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
  forwarder?: string;
  // Enable enhanced metrics on Lambda functions. Defaults to true.
  enableEnhancedMetrics: boolean;
  // When set, the macro will try to automatically add the env tag to lambdas, but will not
  // override existing tags on the function or those set in the Globals section. Defaults to true.
  // (Only successful if an AWS::Serverless::Api resource exists, since the macro uses the generated stage property to tag 'env'.)
  enableAutoEnvTag: boolean;
  // When set, the macro will use this value to add the 'service' tag to all lambdas,
  // but will not override existing 'service' tags on individual lambdas or those set in Globals.
  service?: string;
  // When set, the macro will use this value to add the 'env' tag to all lambdas,
  // but will not override existing 'env' tags on individual lambdas or those set in Globals.
  // If this is set, the stage will not be used to automatically tag 'env', even if
  // enableAutoEnvTag is set to true.
  env?: string;
}

const apiKeyEnvVar = "DD_API_KEY";
const apiKeyKMSEnvVar = "DD_KMS_API_KEY";
const siteURLEnvVar = "DD_SITE";
const logLevelEnvVar = "DD_LOG_LEVEL";
const logForwardingEnvVar = "DD_FLUSH_TO_LOG";
const enhancedMetricsEnvVar = "DD_ENHANCED_METRICS";
const CUSTOM = "Custom";
const DATADOG = "Datadog";

export const defaultConfiguration: Configuration = {
  addLayers: true,
  flushMetricsToLogs: true,
  logLevel: "info",
  site: "datadoghq.com",
  enableXrayTracing: true,
  enableDDTracing: true,
  enableAutoEnvTag: true,
  enableEnhancedMetrics: true,
};

export function getConfigFromMappings(mappings: any): Configuration {
  if (mappings === undefined || mappings[CUSTOM] === undefined) {
    return defaultConfiguration;
  }
  return getConfigFromParams(mappings[CUSTOM][DATADOG]);
}

export function getConfigFromParams(params: { [_: string]: string }) {
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
  funcs: FunctionInfo[]
) {
  funcs.forEach((func) => {
    const environment = func.lambda.Environment ?? {};
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
    func.lambda.Environment = environment;
  });
}
