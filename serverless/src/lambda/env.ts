import { getGitTagsFromParam } from "./git";
import { LambdaFunction, runtimeLookup, RuntimeType } from "./layer";
import { InputEvent } from "types";
import log from "loglevel";

export interface Configuration {
  // Whether to add the Datadog Lambda Library layers, or expect the users to bring their own
  addLayers: boolean;
  // Whether to add the Datadog Extension Library layer
  addExtension: boolean;
  // Python Lambda layer version
  pythonLayerVersion?: number;
  // Node.js Lambda layer version
  nodeLayerVersion?: number;
  // .Net Lambda Layer version
  dotnetLayerVersion?: number;
  // Java Lambda Layer version
  javaLayerVersion?: number;
  // Datadog Lambda Extension layer version
  extensionLayerVersion?: number;
  // Datadog API Key, only necessary when using metrics without log forwarding
  apiKey?: string;
  // The ARN of the secret in AWS Secrets Manager containing the Datadog API key.
  apiKeySecretArn?: string;
  // Datadog API Key encrypted using KMS, only necessary when using metrics without log forwarding
  apiKMSKey?: string;
  // Which Site to send to, (should be datadoghq.com or datadoghq.eu)
  site: string;
  // The log level, (set to DEBUG for extended logging)
  logLevel: string | undefined;
  // Whether the log forwarder integration is enabled. Defaults to true.
  flushMetricsToLogs: boolean;
  // Enable enhanced metrics on Lambda functions. Defaults to true.
  enableEnhancedMetrics: boolean;
  // Enable tracing on Lambda functions using X-Ray. Defaults to false.
  enableXrayTracing: boolean;
  // Enable tracing on Lambda function using dd-trace, datadog's APM library.
  enableDDTracing: boolean;
  // Enable log collection via the Datadog Lambda extension
  enableDDLogs: boolean;
  // When set, the macro will subscribe the lambdas to the forwarder with the given arn.
  forwarderArn?: string;
  // If a forwarder is provided and any lambdas have dynamically generated names,
  // the stack name will be required to create the necessary CloudWatch subscriptions.
  // If a forwarder is provided with dynamically named lambdas, and a stack name is not provided,
  // the subscription will not be added.
  stackName?: string;
  // When set, if an extension version is provided, the macro will use this value to add the 'DD_SERVICE' environment variable to all lambdas,
  // When set, if a forwarder is provided, the macro will use this value to add the 'service' tag to all lambdas
  // but will not override existing 'service' tags/"DD_ENV" environment variables on individual lambdas or those set in Globals.
  service?: string;
  // When set, if an extension version is provided, the macro will use this value to add the 'DD_ENV' environment variable to all lambdas,
  // When set, if a forwarder is provided, the macro will use this value to add the 'env' tag to all lambdas
  // but will not override existing 'env' tags/"DD_ENV" environment variables on individual lambdas or those set in Globals.
  env?: string;
  // When set, if an extension version is provided, the macro will use this value to add the 'DD_VERSION' environment variable to all lambdas,
  // When set, if a forwarder is provided, the macro will use this value to add the 'version' tag to all lambdas
  // but will not override existing 'version' tags/"DD_VERSION" environment variables on individual lambdas or those set in Globals.
  version?: string;
  // When set, if an extension version is provided, the macro will use this value to add the 'DD_TAGS' environment variable to all lambdas,
  // When set, if a forwarder is provided, the macro will use this value to parse the tags and set the key:value pairs to all lambdas
  // but will not override existing tags/"DD_TAGS" environment variables on individual lambdas or those set in Globals.
  tags?: string;
  // Optionally set by customer using `sam deploy --parameter-overrides DDGitData="$(git rev-parse HEAD),$(git config --get remote.origin.url)"`
  // The customer template takes in the DDGitData override param and passes that to this macro's gitData param
  gitData?: string;
  // When set, the list of strings will be evalutated when processing each lambda function. if the string matches that function will not be instrumented by the macro.
  exclude?: string[];
  // When set, the lambda's payload will be captured within the incoming trace.
  captureLambdaPayload: boolean;
  // Cold Start Tracing is enabled by default
  enableColdStartTracing?: boolean;
  // minimum duration to trace a module load span
  minColdStartTraceDuration?: string;
  // User specified list of libraries for Cold Start Tracing to ignore
  coldStartTraceSkipLibs?: string;
  // Enable profiling
  enableProfiling?: boolean;
  // Whether to encode the tracing context in the lambda authorizer's reponse data. Default true
  encodeAuthorizerContext?: boolean;
  // Whether to parse and use the encoded tracing context from lambda authorizers. Default true
  decodeAuthorizerContext?: boolean;
  // Determine when to submit spans before a timeout occurs.
  // When the remaining time in a Lambda invocation is less than `apmFlushDeadline`, the tracer will
  // attempt to submit the current active spans and all finished spans.
  apmFlushDeadline?: string;
}

// Same interface as Configuration above, except all parameters are optional, since user does
// not have to provide the values (in which case we will use the default configuration below).
interface CfnParams extends Partial<Configuration> {}

const apiKeyEnvVar = "DD_API_KEY";
const apiKeySecretArnEnvVar = "DD_API_KEY_SECRET_ARN";
const apiKeyKMSEnvVar = "DD_KMS_API_KEY";
const siteURLEnvVar = "DD_SITE";
const logLevelEnvVar = "DD_LOG_LEVEL";
const logForwardingEnvVar = "DD_FLUSH_TO_LOG";
const enhancedMetricsEnvVar = "DD_ENHANCED_METRICS";
const enableDDLogsEnvVar = "DD_SERVERLESS_LOGS_ENABLED";
const DATADOG = "Datadog";
const PARAMETERS = "Parameters";
const captureLambdaPayloadEnvVar = "DD_CAPTURE_LAMBDA_PAYLOAD";
const serviceEnvVar = "DD_SERVICE";
const envEnvVar = "DD_ENV";
const versionEnvVar = "DD_VERSION";
const tagsEnvVar = "DD_TAGS";
const ddColdStartTracingEnabledEnvVar = "DD_COLD_START_TRACING";
const ddMinColdStartDurationEnvVar = "DD_MIN_COLD_START_DURATION";
const ddColdStartTracingSkipLibsEnvVar = "DD_COLD_START_TRACE_SKIP_LIB";
const ddProfilingEnabledEnvVar = "DD_PROFILING_ENABLED";
const ddEncodeAuthorizerContextEnvVar = "DD_ENCODE_AUTHORIZER_CONTEXT";
const ddDecodeAuthorizerContextEnvVar = "DD_DECODE_AUTHORIZER_CONTEXT";
const ddApmFlushDeadlineMillisecondsEnvVar = "DD_APM_FLUSH_DEADLINE_MILLISECONDS";

export const defaultConfiguration: Configuration = {
  addLayers: true,
  addExtension: false,
  exclude: [],
  flushMetricsToLogs: true,
  logLevel: undefined,
  site: "datadoghq.com",
  enableXrayTracing: false,
  enableDDTracing: true,
  enableDDLogs: true,
  enableEnhancedMetrics: true,
  captureLambdaPayload: false,
};

/**
 * Returns the default configuration with any values overwritten by environment variables.
 */
export function getConfig(event: InputEvent): Configuration {
  let config: Configuration;
  // Use the parameters given for this specific transform/macro if it exists
  const transformParams = event.params ?? {};
  if (Object.keys(transformParams).length > 0) {
    log.debug("Parsing config from CloudFormation transform/macro parameters");
    config = getConfigFromCfnParams(transformParams);
  } else {
    // If not, check the Mappings section for Datadog config parameters as well
    log.debug("Parsing config from CloudFormation template mappings");
    config = getConfigFromCfnMappings(event.fragment.Mappings);
  }
  return config;
}

/**
 * Returns the default configuration with any values overwritten by environment variables.
 */
export function getConfigFromEnvVars(): Configuration {
  const config: Configuration = {
    ...defaultConfiguration,
  };

  if (apiKeyEnvVar in process.env) {
    config.apiKey = process.env[apiKeyEnvVar];
  }
  if (apiKeySecretArnEnvVar in process.env) {
    config.apiKeySecretArn = process.env[apiKeySecretArnEnvVar];
  }
  if (apiKeyKMSEnvVar in process.env) {
    config.apiKMSKey = process.env[apiKeyKMSEnvVar];
  }
  if (siteURLEnvVar in process.env && process.env[siteURLEnvVar] !== undefined) {
    // Fall back to default site for type safety
    config.site = process.env[siteURLEnvVar] ?? defaultConfiguration.site;
  }
  if (logLevelEnvVar in process.env) {
    config.logLevel = process.env[logLevelEnvVar];
  }
  if (logForwardingEnvVar in process.env) {
    config.flushMetricsToLogs = process.env[logForwardingEnvVar] === "true";
  }
  if (enhancedMetricsEnvVar in process.env) {
    config.enableEnhancedMetrics = process.env[enhancedMetricsEnvVar] === "true";
  }
  if (enableDDLogsEnvVar in process.env) {
    config.enableDDLogs = process.env[enableDDLogsEnvVar] === "true";
  }
  if (captureLambdaPayloadEnvVar in process.env) {
    config.captureLambdaPayload = process.env[captureLambdaPayloadEnvVar] === "true";
  }
  if (serviceEnvVar in process.env) {
    config.service = process.env[serviceEnvVar];
  }
  if (envEnvVar in process.env) {
    config.env = process.env[envEnvVar];
  }
  if (versionEnvVar in process.env) {
    config.version = process.env[versionEnvVar];
  }
  if (tagsEnvVar in process.env) {
    config.tags = process.env[tagsEnvVar];
  }
  if (ddColdStartTracingEnabledEnvVar in process.env) {
    config.enableColdStartTracing = process.env[ddColdStartTracingEnabledEnvVar] === "true";
  }
  if (ddMinColdStartDurationEnvVar in process.env) {
    config.minColdStartTraceDuration = process.env[ddMinColdStartDurationEnvVar];
  }
  if (ddColdStartTracingSkipLibsEnvVar in process.env) {
    config.coldStartTraceSkipLibs = process.env[ddColdStartTracingSkipLibsEnvVar];
  }
  if (ddProfilingEnabledEnvVar in process.env) {
    config.enableProfiling = process.env[ddProfilingEnabledEnvVar] === "true";
  }
  if (ddEncodeAuthorizerContextEnvVar in process.env) {
    config.encodeAuthorizerContext = process.env[ddEncodeAuthorizerContextEnvVar] === "true";
  }
  if (ddDecodeAuthorizerContextEnvVar in process.env) {
    config.decodeAuthorizerContext = process.env[ddDecodeAuthorizerContextEnvVar] === "true";
  }
  if (ddApmFlushDeadlineMillisecondsEnvVar in process.env) {
    config.apmFlushDeadline = process.env[ddApmFlushDeadlineMillisecondsEnvVar];
  }

  return config;
}

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
    log.debug("No Datadog mappings found in the CloudFormation template, using the default config");
    return getConfigFromEnvVars();
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
    log.debug("No Datadog config found, using the default config");
    datadogConfig = {};
  }
  return {
    ...getConfigFromEnvVars(),
    ...datadogConfig,
  };
}

export function validateParameters(config: Configuration): string[] {
  log.debug("Validating parameters...");
  const errors: string[] = [];

  const multipleApiKeysMessage = checkForMultipleApiKeys(config);
  if (multipleApiKeysMessage) {
    errors.push(`${multipleApiKeysMessage} should not be set at the same time.`);
  }
  const siteList: string[] = [
    "datadoghq.com",
    "datadoghq.eu",
    "us3.datadoghq.com",
    "us5.datadoghq.com",
    "ap1.datadoghq.com",
    "ddog-gov.com",
  ];
  if (config.site !== undefined && !siteList.includes(config.site.toLowerCase())) {
    errors.push(
      "Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, us5.datadoghq.com, ap1.datadoghq.com, or ddog-gov.com.",
    );
  }
  if (config.addExtension === true) {
    if (config.extensionLayerVersion === undefined) {
      errors.push("Please add the `extensionLayerVersion` parameter when `addExtension` is set.");
    }
  }
  if (config.extensionLayerVersion !== undefined) {
    if (config.forwarderArn !== undefined) {
      errors.push(
        "setting `forwarderArn` with `addExtension` and/or `extensionLayerVersion` as these parameters cannot be set at the same time.",
      );
    }
    if (config.apiKey === undefined && config.apiKeySecretArn === undefined && config.apiKMSKey === undefined) {
      errors.push("When `extensionLayerVersion` is set, `apiKey`, `apiKeySecretArn`, or `apiKmsKey` must also be set.");
    }
  }

  return errors;
}

export function checkForMultipleApiKeys(config: Configuration): string | undefined {
  let multipleApiKeysMessage;
  if (config.apiKey !== undefined && config.apiKMSKey !== undefined && config.apiKeySecretArn !== undefined) {
    multipleApiKeysMessage = "`apiKey`, `apiKMSKey`, and `apiKeySecretArn`";
  } else if (config.apiKey !== undefined && config.apiKMSKey !== undefined) {
    multipleApiKeysMessage = "`apiKey` and `apiKMSKey`";
  } else if (config.apiKey !== undefined && config.apiKeySecretArn !== undefined) {
    multipleApiKeysMessage = "`apiKey` and `apiKeySecretArn`";
  } else if (config.apiKMSKey !== undefined && config.apiKeySecretArn !== undefined) {
    multipleApiKeysMessage = "`apiKMSKey` and `apiKeySecretArn`";
  }

  return multipleApiKeysMessage;
}

export function setEnvConfiguration(config: Configuration, lambdas: LambdaFunction[]): void {
  lambdas.forEach((lambda) => {
    const environment = lambda.properties.Environment ?? {};
    const envVariables = environment.Variables ?? {};

    if (config.apiKey !== undefined && envVariables[apiKeyEnvVar] === undefined) {
      envVariables[apiKeyEnvVar] = config.apiKey;
    }

    if (config.apiKeySecretArn !== undefined && envVariables[apiKeySecretArnEnvVar] === undefined) {
      const isNode = runtimeLookup[lambda.runtime] === RuntimeType.NODE;
      const isSendingSynchronousMetrics = config.extensionLayerVersion === undefined && !config.flushMetricsToLogs;
      if (isSendingSynchronousMetrics && isNode) {
        throw new Error(
          `\`apiKeySecretArn\` is not supported for Node runtimes (${lambda.properties.FunctionName}) when using Synchronous Metrics. Use either \`apiKey\` or \`apiKmsKey\`.`,
        );
      }
      envVariables[apiKeySecretArnEnvVar] = config.apiKeySecretArn;
    }

    if (config.apiKMSKey !== undefined && envVariables[apiKeyKMSEnvVar] === undefined) {
      envVariables[apiKeyKMSEnvVar] = config.apiKMSKey;
    }

    if (envVariables[siteURLEnvVar] === undefined) {
      envVariables[siteURLEnvVar] = config.site;
    }

    if (config.logLevel !== undefined) {
      envVariables[logLevelEnvVar] = config.logLevel;
    }

    if (envVariables[logForwardingEnvVar] === undefined) {
      envVariables[logForwardingEnvVar] = config.flushMetricsToLogs;
    }

    if (envVariables[enhancedMetricsEnvVar] === undefined) {
      envVariables[enhancedMetricsEnvVar] = config.enableEnhancedMetrics;
    }

    if (config.enableDDLogs !== undefined && envVariables[enableDDLogsEnvVar] === undefined) {
      envVariables[enableDDLogsEnvVar] = config.enableDDLogs;
    }

    if (config.captureLambdaPayload !== undefined && envVariables[captureLambdaPayloadEnvVar] === undefined) {
      envVariables[captureLambdaPayloadEnvVar] = config.captureLambdaPayload;
    }

    if (config.service !== undefined && envVariables[serviceEnvVar] === undefined) {
      envVariables[serviceEnvVar] = config.service;
    }

    if (config.env !== undefined && envVariables[envEnvVar] === undefined) {
      envVariables[envEnvVar] = config.env;
    }

    if (config.extensionLayerVersion && config.version !== undefined && envVariables[versionEnvVar] === undefined) {
      envVariables[versionEnvVar] = config.version;
    }

    if (config.tags !== undefined && envVariables[tagsEnvVar] === undefined) {
      envVariables[tagsEnvVar] = config.tags;
    }

    if (config.gitData !== undefined) {
      const { gitCommitShaTag, gitRepoUrlTag } = getGitTagsFromParam(config.gitData);
      const gitTagString = `${gitCommitShaTag},${gitRepoUrlTag}`;

      if (envVariables[tagsEnvVar] !== undefined) {
        envVariables[tagsEnvVar] = `${envVariables[tagsEnvVar]},${gitTagString}`;
      } else {
        envVariables[tagsEnvVar] = gitTagString;
      }
    }

    if (config.enableColdStartTracing !== undefined && envVariables[ddColdStartTracingEnabledEnvVar] === undefined) {
      envVariables[ddColdStartTracingEnabledEnvVar] = config.enableColdStartTracing;
    }
    if (config.minColdStartTraceDuration !== undefined && envVariables[ddMinColdStartDurationEnvVar] === undefined) {
      envVariables[ddMinColdStartDurationEnvVar] = config.minColdStartTraceDuration;
    }
    if (config.coldStartTraceSkipLibs !== undefined && envVariables[ddColdStartTracingSkipLibsEnvVar] === undefined) {
      envVariables[ddColdStartTracingSkipLibsEnvVar] = config.coldStartTraceSkipLibs;
    }
    if (config.enableProfiling !== undefined && envVariables[ddProfilingEnabledEnvVar] === undefined) {
      envVariables[ddProfilingEnabledEnvVar] = config.enableProfiling;
    }
    if (config.encodeAuthorizerContext !== undefined && envVariables[ddEncodeAuthorizerContextEnvVar] === undefined) {
      envVariables[ddEncodeAuthorizerContextEnvVar] = config.encodeAuthorizerContext;
    }
    if (config.decodeAuthorizerContext !== undefined && envVariables[ddDecodeAuthorizerContextEnvVar] === undefined) {
      envVariables[ddDecodeAuthorizerContextEnvVar] = config.decodeAuthorizerContext;
    }
    if (config.apmFlushDeadline !== undefined && envVariables[ddApmFlushDeadlineMillisecondsEnvVar] === undefined) {
      envVariables[ddApmFlushDeadlineMillisecondsEnvVar] = config.apmFlushDeadline;
    }
    environment.Variables = envVariables;
    lambda.properties.Environment = environment;
  });
}
