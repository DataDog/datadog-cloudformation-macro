import { InputEvent, OutputEvent, SUCCESS, Resources } from "../types";
import log from "loglevel";
import { StateMachine, StateMachineProperties } from "../../src/step_function/types";
import { setUpLogging } from "../../src/step_function/log";

const STATE_MACHINE_RESOURCE_TYPE = "AWS::StepFunctions::StateMachine";

export async function instrumentStateMachines(event: InputEvent): Promise<OutputEvent> {
  const fragment = event.fragment;
  const resources = fragment.Resources;

  const stateMachines = findStateMachines(resources);
  for (const stateMachine of stateMachines) {
    instrumentStateMachine(resources, stateMachine);
  }

  return {
    requestId: event.requestId,
    status: SUCCESS,
    fragment,
  };
}

function instrumentStateMachine(resources: Resources, stateMachine: StateMachine): void {
  log.debug(`Instrumenting State Machine ${stateMachine.resourceKey}`);
  setUpLogging(resources, stateMachine);
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
