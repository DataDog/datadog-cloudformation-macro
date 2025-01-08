import { Resources } from "../types";
import log from "loglevel";
import { StateMachine } from "./types";
import { Configuration } from "./env";

/**
 * Set up logging for the given state machine:
 * 1. Set log level to ALL
 * 2. Set includeExecutionData to true
 * 3. Create a destination log group (if not set already)
 */
export function setUpLogging(resources: Resources, config: Configuration, stateMachine: StateMachine): void {
  log.debug(`Setting up logging`);
  if (!stateMachine.properties.LoggingConfiguration) {
    stateMachine.properties.LoggingConfiguration = {};
  }

  const logConfig = stateMachine.properties.LoggingConfiguration;

  logConfig.Level = "ALL";
  logConfig.IncludeExecutionData = true;

  if (!logConfig.Destinations) {
    log.debug(`Log destination not found, creating one`);
    const logGroupKey = createLogGroup(resources, config, stateMachine);
    logConfig.Destinations = [
      {
        CloudWatchLogsLogGroup: {
          LogGroupArn: {
            "Fn::GetAtt": [logGroupKey, "Arn"],
          },
        },
      },
    ];
  } else {
    log.debug(`Log destination already exists, skipping creating one`);
  }
}

function createLogGroup(resources: Resources, config: Configuration, stateMachine: StateMachine): string {
  const logGroupKey = `${stateMachine.resourceKey}LogGroup`;
  resources[logGroupKey] = {
    Type: "AWS::Logs::LogGroup",
    Properties: {
      LogGroupName: buildLogGroupName(stateMachine, config.env),
      RetentionInDays: 7,
    },
  };

  return logGroupKey;
}

/**
 * Builds log group name for a state machine.
 * @returns log group name like "/aws/vendedlogs/states/MyStateMachine-Logs" (without env)
 *                           or "/aws/vendedlogs/states/MyStateMachine-Logs-dev" (with env)
 */
export const buildLogGroupName = (stateMachine: StateMachine, env: string | undefined): string => {
  return `/aws/vendedlogs/states/${stateMachine.resourceKey}-Logs${env !== undefined ? "-" + env : ""}`;
};
