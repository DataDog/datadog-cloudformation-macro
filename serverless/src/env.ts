import { InputEvent } from "types";
import log from "loglevel";

const DATADOG = "Datadog";
const PARAMETERS = "Parameters";

export abstract class ConfigLoader<TConfig> {
  abstract readonly defaultConfiguration: TConfig;
  /**
   * Returns the default configuration with any values overwritten by environment variables.
   */
  abstract getConfigFromEnvVars(): TConfig;

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
  public getConfig(event: InputEvent): TConfig {
    let config: TConfig;
    // Use the parameters given for this specific transform/macro if it exists
    const transformParams = event.params ?? {};
    if (Object.keys(transformParams).length > 0) {
      log.debug("Parsing config from CloudFormation transform/macro parameters");
      config = this.getConfigFromCfnParams(transformParams as Partial<TConfig>);
    } else {
      // If not, check the Mappings section for Datadog config parameters as well
      log.debug("Parsing config from CloudFormation template mappings");
      config = this.getConfigFromCfnMappings(event.fragment.Mappings);
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
  public getConfigFromCfnMappings(mappings: any): TConfig {
    if (mappings === undefined || mappings[DATADOG] === undefined) {
      log.debug("No Datadog mappings found in the CloudFormation template, using the default config");
      return this.getConfigFromEnvVars();
    }
    return this.getConfigFromCfnParams(mappings[DATADOG][PARAMETERS]);
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
  public getConfigFromCfnParams(datadogConfig: Partial<TConfig> | undefined) {
    if (datadogConfig === undefined) {
      log.debug("No Datadog config found, using the default config");
      datadogConfig = {};
    }
    return {
      ...this.getConfigFromEnvVars(),
      ...datadogConfig,
    };
  }
}
