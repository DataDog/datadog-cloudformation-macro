import { ConfigLoader } from "../common/env";

export interface Configuration {
  // When set, it will be added to the state machine's log group name.
  env?: string;
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
