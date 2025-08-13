import { StateMachine } from "./types";
import { Configuration } from "./env";
import { version } from "../../package.json";
import { addDDTags, addMacroTag } from "../common/tags";

const DD_TRACE_ENABLED = "DD_TRACE_ENABLED";

export function addTags(config: Configuration, stateMachine: StateMachine): void {
  addDDTags(stateMachine, config);
  addMacroTag(stateMachine, version);
  addDDTraceEnabledTag(stateMachine);
}

function addDDTraceEnabledTag(stateMachine: StateMachine): void {
  const tags = stateMachine.properties.Tags ?? [];
  tags.push({ Key: DD_TRACE_ENABLED, Value: "true" });
  stateMachine.properties.Tags = tags;
}
