import { Resources } from "../common/types";
import { Configuration } from "./env";
import { StateMachine } from "./types";
import { findLogGroup } from "./log";
import log from "loglevel";

export const SUBSCRIPTION_FILTER_PREFIX = "LogGroupDatadogSubscriptionFilter";

/**
 * Subscribe the forwarder to the state machine's log group.
 */
export function addForwarder(resources: Resources, config: Configuration, stateMachine: StateMachine): void {
  log.debug(`Subscribing the forwarder to the log group...`);
  const logGroup = findLogGroup(resources, stateMachine);
  const subscriptionFilter = {
    Type: "AWS::Logs::SubscriptionFilter",
    Properties: {
      LogGroupName: logGroup.Properties.LogGroupName,
      DestinationArn: config.stepFunctionForwarderArn,
      FilterPattern: "",
    },
  };
  const subscriptionFilterKey = stateMachine.resourceKey + "LogGroupDatadogSubscriptionFilter";
  resources[subscriptionFilterKey] = subscriptionFilter;
}
