import { InputEvent } from "types";
import log from "loglevel";

export interface Configuration {
  // When set, it will be added to the state machine's log group name.
  env?: string;
}

const DATADOG = "Datadog";
const PARAMETERS = "Parameters";
const envEnvVar = "DD_ENV";

// Same interface as Configuration above, except all parameters are optional, since user does
// not have to provide the values (in which case we will use the default configuration below).
interface CfnParams extends Partial<Configuration> {}

export const defaultConfiguration: Configuration = {};

/**
 * Returns the configuration.
 * If DatadogServerless transform params are set, then the priority order is:
 *   1. CloudFormation Macro params
 *   2. Environment variables
 *   3. Default configuration
 * Otherwise, if CloudFormation Mappings for Datadog are set, then the priority order is:
 *   1. CloudFormation Mappings params
 *   2. Environment variables
 *   3. Default configuration
 * Otherwise, the priority order is:
 *   1. Environment variables
 *   2. Default configuration
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
function getConfigFromEnvVars(): Configuration {
  const config: Configuration = {
    ...defaultConfiguration,
  };

  if (envEnvVar in process.env) {
    config.env = process.env[envEnvVar];
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
function getConfigFromCfnMappings(mappings: any): Configuration {
  if (mappings !== undefined && mappings[DATADOG] !== undefined) {
    return getConfigFromCfnParams(mappings[DATADOG][PARAMETERS]);
  }
  log.debug("No Datadog mappings found in the CloudFormation template, using the default config");
  return getConfigFromEnvVars();
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
function getConfigFromCfnParams(params: CfnParams) {
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
