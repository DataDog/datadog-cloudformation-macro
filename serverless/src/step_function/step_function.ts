import { InputEvent, OutputEvent, SUCCESS, Resources } from "../common/types";
import log from "loglevel";
import { StateMachine, StateMachineProperties } from "./types";
import { Configuration } from "./env";
import { setUpLogging } from "./log";
import { addForwarder } from "./forwarder";
import { addTags } from "./tags";
import { mergeTracesWithDownstream } from "./span-link";

const STATE_MACHINE_RESOURCE_TYPE = "AWS::StepFunctions::StateMachine";

export async function instrumentStateMachines(event: InputEvent, config: Configuration): Promise<OutputEvent> {
  const fragment = event.fragment;

  if (!config.stepFunctionForwarderArn) {
    log.info("stepFunctionForwarderArn is not provided. Step functions will not be instrumented.");
    return {
      requestId: event.requestId,
      status: SUCCESS,
      fragment,
    };
  }

  const resources = fragment.Resources;
  const stateMachines = findStateMachines(resources);
  for (const stateMachine of stateMachines) {
    instrumentStateMachine(resources, config, stateMachine);
  }

  return {
    requestId: event.requestId,
    status: SUCCESS,
    fragment,
  };
}

function instrumentStateMachine(resources: Resources, config: Configuration, stateMachine: StateMachine): void {
  log.debug(`Instrumenting State Machine ${stateMachine.resourceKey}`);

  setUpLogging(resources, config, stateMachine);

  addForwarder(resources, config, stateMachine);

  addTags(config, stateMachine);

  mergeTracesWithDownstream(resources, stateMachine);
}

export function findStateMachines(resources: Resources): StateMachine[] {
  return Object.entries(resources)
    .map(([key, resource]) => {
      if (resource.Type !== STATE_MACHINE_RESOURCE_TYPE) {
        log.debug(`Resource ${key} is not a State Machine, skipping...`);
        return;
      }

      const properties: StateMachineProperties = resource.Properties;

      return {
        properties: properties,
        resourceKey: key,
      } as StateMachine;
    })
    .filter((resource) => resource !== undefined) as StateMachine[];
}
