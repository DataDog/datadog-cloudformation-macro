import { ConfigLoader } from "../common/env";
import { ConfigurationWithTags } from "common/tags";

export interface Configuration extends ConfigurationWithTags {
  // When set, it will be added to the state machine's log group name and added as a tag.
  env?: string;
  // When set, it will be added as a tag of the state machine.
  service?: string;
  // When set, it will be added as a tag of the state machine.
  version?: string;
  // Custom tags to be added to the state machine, in the format "key1:value1,key2:value2".
  tags?: string;
  // When set, the forwarder will subscribe to the state machine's log group.
  stepFunctionForwarderArn?: string;
}

const envEnvVar = "DD_ENV";

export class StepFunctionConfigLoader extends ConfigLoader<Configuration> {
  readonly defaultConfiguration: Configuration = {};

  public getConfigFromEnvVars(): Configuration {
    const config: Configuration = {
      ...this.defaultConfiguration,
    };

    if (envEnvVar in process.env) {
      config.env = process.env[envEnvVar];
    }

    return config;
  }
}
