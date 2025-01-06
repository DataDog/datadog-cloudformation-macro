import { Resources } from "../types";
import log from "loglevel";
import { StateMachine } from "./types";

/**
 * Set up logging for the given state machine:
 * 1. Set log level to ALL
 * 2. Set includeExecutionData to true
 */
export function setUpLogging(_resources: Resources, stateMachine: StateMachine): void {
  log.debug(`Setting up logging`);
  if (!stateMachine.properties.LoggingConfiguration) {
    stateMachine.properties.LoggingConfiguration = {};
  }

  const logConfig = stateMachine.properties.LoggingConfiguration;

  logConfig.Level = "ALL";
  logConfig.IncludeExecutionData = true;
}
